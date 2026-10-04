import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  debriefStatus,
  decideFloor,
  decideWrapUp,
  endsWithQuestion,
  isDebriefQuestion,
  isQuestion,
  MAX_EXPLAIN_REFUSALS,
  MAX_TEACH_BACK_REFUSALS,
  MIN_DEBRIEF_QUESTIONS,
  MIN_TEACH_BACK_WORDS,
  policyFrom,
  teachBackStatus,
  type FloorInput,
  type WrapUpInput,
} from "./floor";
import { defaultSettings, type Settings } from "./settings";

const MIN = 60_000;
// Five minutes in, after a step, with everything quiet: the moment to ask.
const ready: FloorInput = {
  now: 5 * MIN,
  observingSince: 0,
  speaking: false,
  lastSpeechAt: 5 * MIN - 10_000,
  lastActivityAt: 5 * MIN - 10_000,
  agentSpeaking: false,
  pending: [{ at: 5 * MIN - 12_000, kind: "action" }],
  questionTimes: [],
  lastPauseAt: -Infinity,
};

describe("decideFloor", () => {
  it("asks at a pause after a step", () => {
    expect(decideFloor(ready)).toBe("ask");
  });

  it("stays quiet while the expert talks, and for a moment after", () => {
    expect(decideFloor({ ...ready, speaking: true })).toBe("talking");
    expect(decideFloor({ ...ready, lastSpeechAt: ready.now - 1000 })).toBe("talking");
  });

  it("stays quiet while the screen is moving (typing, scrolling)", () => {
    expect(decideFloor({ ...ready, lastActivityAt: ready.now - 500 })).toBe("busy");
  });

  it("gives them time to read what just opened", () => {
    const opened = {
      ...ready,
      pending: [...ready.pending, { at: ready.now - 3000, kind: "navigation" as const }],
    };
    expect(decideFloor(opened)).toBe("reading");
    expect(
      decideFloor({ ...opened, now: ready.now + 6000, lastSpeechAt: 0, lastActivityAt: 0 }),
    ).toBe("ask");
  });

  it("asks about what they opened until three questions are asked, then only after actions", () => {
    const looked = { ...ready, pending: [{ at: 0, kind: "navigation" as const }] };
    expect(decideFloor(looked)).toBe("ask");
    const three = [1, 2, 3].map((m) => m * MIN);
    expect(decideFloor({ ...looked, questionTimes: three })).toBe("quiet");
    expect(decideFloor({ ...ready, pending: [] })).toBe("quiet");
  });

  it("does not talk over the agent", () => {
    expect(decideFloor({ ...ready, agentSpeaking: true })).toBe("quiet");
  });

  it("asks less: waits after the start, between questions and after a passed pause", () => {
    expect(decideFloor({ ...ready, observingSince: ready.now - 10_000 })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: [ready.now - 30_000] })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: [ready.now - 45_000] })).toBe("ask");
    expect(decideFloor({ ...ready, lastPauseAt: ready.now - 5000 })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: [ready.now - 2 * MIN] })).toBe("ask");
  });

  it("has no upper limit, but spaces questions out more after the first three", () => {
    const five = [1, 2, 3, 3.5, 4].map((m) => m * MIN);
    expect(decideFloor({ ...ready, questionTimes: five, now: 4 * MIN + 60_000 })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: five, now: 4 * MIN + 80_000 })).toBe("ask");
  });
});

// Just after End: one question was requested 30 s ago, asked, answered, and it's quiet now.
const wrap: WrapUpInput = {
  now: 100_000,
  speaking: false,
  agentSpeaking: false,
  lastSpeechAt: 95_000,
  agentDoneAt: 96_000,
  grant: "answer",
  floorOpenUntil: 0,
  lastPauseAt: 70_000,
  last: { at: 72_000, kind: "reason" },
  met: false,
  prompts: 1,
  limit: 3,
};

describe("decideWrapUp", () => {
  it("asks the next missing question once the answer is in and it's quiet", () => {
    expect(decideWrapUp(wrap)).toBe("ask");
  });

  it("goes to the debrief once enough questions, one about a guardrail, are asked", () => {
    expect(decideWrapUp({ ...wrap, met: true })).toBe("finish");
  });

  it("goes to the debrief when the tries run out", () => {
    expect(decideWrapUp({ ...wrap, prompts: 3 })).toBe("finish");
  });

  it("waits while anyone talks, and for a moment after", () => {
    expect(decideWrapUp({ ...wrap, speaking: true })).toBe("wait");
    expect(decideWrapUp({ ...wrap, agentSpeaking: true })).toBe("wait");
    expect(decideWrapUp({ ...wrap, lastSpeechAt: wrap.now - 1000 })).toBe("wait");
  });

  it("waits for the question's label, which decides the guardrail", () => {
    expect(decideWrapUp({ ...wrap, last: { at: 72_000, kind: "pending" } })).toBe("wait");
  });

  it("waits while the requested question may still come, then asks again", () => {
    const requested = {
      ...wrap,
      grant: "pause" as const,
      lastPauseAt: 90_000,
      floorOpenUntil: 105_000,
    };
    expect(decideWrapUp(requested)).toBe("wait");
    expect(decideWrapUp({ ...requested, now: 106_000 })).toBe("ask");
  });

  it("waits for an answer, but not forever", () => {
    const unanswered = { ...wrap, lastSpeechAt: 60_000, agentDoneAt: 96_000 };
    expect(decideWrapUp(unanswered)).toBe("wait");
    expect(decideWrapUp({ ...unanswered, now: 117_000 })).toBe("ask");
  });

  it("asks again at once when the reply to the request was not a question", () => {
    expect(decideWrapUp({ ...wrap, last: { at: 50_000, kind: "reason" } })).toBe("ask");
  });
});

describe("debriefStatus", () => {
  const gaps = [
    "What is the approval limit for an invoice amount?",
    "Which supplier names need a second check?",
    "Who do you ask when the purchase order is missing?",
    "What happens with currency conversions?",
  ];

  it("asks for all three when none are asked yet, from the open gaps", () => {
    expect(debriefStatus({ asked: [], gaps })).toEqual({
      met: false,
      remaining: MIN_DEBRIEF_QUESTIONS,
      next: gaps.slice(0, 3),
    });
  });

  it("needs one more after two", () => {
    const s = debriefStatus({ asked: ["Why that?", "And then?"], gaps });
    expect(s.met).toBe(false);
    expect(s.remaining).toBe(1);
    expect(s.next).toEqual([gaps[0]]);
  });

  it("is met after three, with nothing more to suggest", () => {
    expect(debriefStatus({ asked: ["a?", "b?", "c?"], gaps })).toEqual({
      met: true,
      remaining: 0,
      next: [],
    });
  });

  it("skips gaps already asked about", () => {
    const s = debriefStatus({
      asked: ["Is there an approval limit on the invoice amount?"],
      gaps,
    });
    expect(s.remaining).toBe(2);
    expect(s.next).toEqual([gaps[1], gaps[2]]);
  });

  it("keeps a gap that only shares a word with an asked question", () => {
    const s = debriefStatus({ asked: ["Which invoice comes first?"], gaps });
    expect(s.next[0]).toBe(gaps[0]);
  });

  it("suggests nothing when there are no gaps, but still needs the questions", () => {
    expect(debriefStatus({ asked: ["a?"], gaps: [] })).toEqual({
      met: false,
      remaining: 2,
      next: [],
    });
    expect(debriefStatus({ asked: [], gaps: ["  "] }).next).toEqual([]);
  });
});

describe("teachBackStatus", () => {
  const long =
    "So you open each invoice, match it to the purchase order, check the amount against the limit, and if the supplier is new or the order is missing you hold it and ask finance before you approve.";

  it("wants an explanation first", () => {
    expect(teachBackStatus({ explained: [], confirmedBy: "Yes" })).toBe("explain_first");
    expect(teachBackStatus({ explained: ["Got it, thanks."], confirmedBy: "Yes" })).toBe(
      "explain_first",
    );
  });

  it("counts the words across the teach-back lines", () => {
    const words = long.split(" ");
    const halves = [words.slice(0, 20).join(" "), words.slice(20).join(" ")];
    expect(teachBackStatus({ explained: halves, confirmedBy: "Yes, that's right." })).toBe("ok");
    expect(words.length).toBeGreaterThanOrEqual(MIN_TEACH_BACK_WORDS);
  });

  it("waits for the expert to answer", () => {
    expect(teachBackStatus({ explained: [long], confirmedBy: "" })).toBe("await_confirmation");
    expect(teachBackStatus({ explained: [long], confirmedBy: "  " })).toBe("await_confirmation");
  });

  it("is ok once explained and answered", () => {
    expect(teachBackStatus({ explained: [long], confirmedBy: "Yes, that's it." })).toBe("ok");
  });

  it("is not confirmed when the expert says no or corrects it", () => {
    const status = (confirmedBy: string) => teachBackStatus({ explained: [long], confirmedBy });
    expect(status("No, the limit is five thousand.")).toBe("not_confirmed");
    expect(status("Yes, but only for new suppliers.")).toBe("not_confirmed");
    expect(status("Not quite.")).toBe("not_confirmed");
    expect(status("Mostly, except the currency part.")).toBe("not_confirmed");
    expect(status("That’s wrong about the order.")).toBe("not_confirmed");
    expect(status("Nein, das Limit ist höher.")).toBe("not_confirmed");
    expect(status("Ja, aber nur bei neuen Lieferanten.")).toBe("not_confirmed");
    expect(status("Das stimmt nicht ganz.")).toBe("not_confirmed");
    expect(status("Alles, außer der Währung.")).toBe("not_confirmed");
  });

  it("is ok on a plain yes, in any language", () => {
    const status = (confirmedBy: string) => teachBackStatus({ explained: [long], confirmedBy });
    expect(status("Yes, exactly right.")).toBe("ok");
    expect(status("Ja, genau so.")).toBe("ok");
    expect(status("Oui, c'est ça.")).toBe("ok");
  });

  it("takes 'actually' after a clear yes as a yes, and as a correction otherwise", () => {
    const status = (confirmedBy: string) => teachBackStatus({ explained: [long], confirmedBy });
    expect(status("Yes, that's actually right.")).toBe("ok");
    expect(status("Yeah, that's actually spot on.")).toBe("ok");
    expect(status("Ja, eigentlich passt das.")).toBe("ok");
    expect(status("Actually, the limit is higher.")).toBe("not_confirmed");
    expect(status("Eigentlich ist das Limit höher.")).toBe("not_confirmed");
    expect(status("Yes, except the currency part.")).toBe("not_confirmed");
  });

  it("catches a yes followed by a but", () => {
    const status = (confirmedBy: string) => teachBackStatus({ explained: [long], confirmedBy });
    expect(status("Yes. But it's net.")).toBe("not_confirmed");
    expect(status("Yeah but it's net.")).toBe("not_confirmed");
    expect(status("But it's net, not gross.")).toBe("not_confirmed");
    expect(status("Aber nur netto.")).toBe("not_confirmed");
  });

  it("counts words in languages written without spaces", () => {
    const zh =
      "你先打开每张发票，把它和采购订单核对，检查金额是否超过限额。如果供应商是新的，或者订单缺失，就先暂停，并在批准之前询问财务部门。";
    const ja =
      "まず請求書を開いて、注文書と照らし合わせ、金額が上限を超えていないか確認します。新しい取引先や注文書がない場合は保留にして、承認する前に経理に確認します。";
    expect(teachBackStatus({ explained: [zh], confirmedBy: "对，没错。" })).toBe("ok");
    expect(teachBackStatus({ explained: [ja], confirmedBy: "はい、その通りです。" })).toBe("ok");
    expect(teachBackStatus({ explained: ["好的。"], confirmedBy: "对。" })).toBe("explain_first");
  });

  it("gives way on a short explanation after enough refusals, never on a no or no answer", () => {
    const short = { explained: ["Got it, thanks."], confirmedBy: "Yes." };
    expect(teachBackStatus({ ...short, refusals: MAX_EXPLAIN_REFUSALS - 1 })).toBe("explain_first");
    expect(teachBackStatus({ ...short, refusals: MAX_EXPLAIN_REFUSALS })).toBe("ok");
    expect(teachBackStatus({ ...short, confirmedBy: "", refusals: 9 })).toBe("await_confirmation");
    expect(teachBackStatus({ ...short, confirmedBy: "No.", refusals: 9 })).toBe("not_confirmed");
  });
});

describe("debriefStatus refusals", () => {
  it("lets the teach-back go ahead after enough refusals", () => {
    const one = { asked: ["Why?"], gaps: [] };
    expect(debriefStatus({ ...one, refusals: MAX_TEACH_BACK_REFUSALS - 1 }).met).toBe(false);
    const forced = debriefStatus({ ...one, refusals: MAX_TEACH_BACK_REFUSALS });
    expect(forced.met).toBe(true);
    expect(forced.remaining).toBe(2);
  });
});

describe("isDebriefQuestion", () => {
  it("counts a real question, however short", () => {
    expect(isDebriefQuestion("Why?")).toBe(true);
    expect(isDebriefQuestion("Got it. What happens when the PO is missing?")).toBe(true);
    expect(isDebriefQuestion("Warum prüfst du den Lieferanten zuerst?")).toBe(true);
  });

  it("doesn't count check-ins", () => {
    expect(isDebriefQuestion("Is that right?")).toBe(false);
    expect(isDebriefQuestion("Okay?")).toBe(false);
    expect(isDebriefQuestion("Stimmt das?")).toBe(false);
    expect(isDebriefQuestion("Das Limit ist fünftausend, oder?")).toBe(false);
    expect(
      isDebriefQuestion(
        "So you match each invoice to its order and hold the new suppliers. Is that how it works?",
      ),
    ).toBe(false);
  });

  it("counts a line with a check-in and a real question", () => {
    expect(isDebriefQuestion("Does that make sense? And who approves above the limit?")).toBe(true);
  });

  it("doesn't count a line without a question", () => {
    expect(isDebriefQuestion("Thanks, that helps.")).toBe(false);
  });

  it("knows the question marks of other scripts", () => {
    expect(isDebriefQuestion("为什么要先检查供应商？")).toBe(true);
    expect(isDebriefQuestion("なぜ先に取引先を確認するのですか？")).toBe(true);
    expect(isDebriefQuestion("لماذا تتحقق من المورد أولاً؟")).toBe(true);
    expect(isDebriefQuestion("Ինչու՞ ես նախ ստուգում մատակարարին")).toBe(true);
    expect(isDebriefQuestion("Γιατί ελέγχεις πρώτα τον προμηθευτή;")).toBe(true);
    expect(isDebriefQuestion("Γιατί ελέγχεις πρώτα τον προμηθευτή;")).toBe(true);
  });

  it("doesn't take a semicolon outside Greek for a question", () => {
    expect(isDebriefQuestion("First the supplier; then the amount.")).toBe(false);
  });
});

describe("isQuestion", () => {
  it("counts a question in English and German, check-ins included", () => {
    expect(isQuestion("What happens when the PO is missing?")).toBe(true);
    expect(isQuestion("Right?")).toBe(true);
    expect(isQuestion("Warum prüfst du den Lieferanten zuerst?")).toBe(true);
    expect(isQuestion("Got it.")).toBe(false);
    expect(isQuestion("Verstanden, danke.")).toBe(false);
  });

  it("counts questions in other scripts", () => {
    expect(isQuestion("为什么先检查供应商？")).toBe(true);
    expect(isQuestion("我明白了。")).toBe(false);
    expect(isQuestion("なぜ先に仕入先を確認するのですか？")).toBe(true);
    expect(isQuestion("わかりました。")).toBe(false);
    expect(isQuestion("لماذا تتحقق من المورد أولاً؟")).toBe(true);
    expect(isQuestion("فهمت.")).toBe(false);
    expect(isQuestion("چرا اول تأمین‌کننده را بررسی می‌کنی؟")).toBe(true);
    expect(isQuestion("متوجه شدم.")).toBe(false);
    expect(isQuestion("Ինչո՞ւ ես նախ ստուգում մատակարարին")).toBe(true);
    expect(isQuestion("Հասկացա։")).toBe(false);
  });

  it("reads the Greek question mark only in Greek", () => {
    expect(isQuestion("Γιατί ελέγχεις πρώτα τον προμηθευτή;")).toBe(true);
    expect(isQuestion("Γιατί ελέγχεις πρώτα τον προμηθευτή\u037E")).toBe(true);
    expect(isQuestion("Κατάλαβα.")).toBe(false);
    expect(isQuestion("I check the supplier first; then the order.")).toBe(false);
  });

  it("finds a question mid-line", () => {
    expect(isQuestion("Warum? Egal.")).toBe(true);
  });

  it("ignores empty lines and stray marks", () => {
    expect(isQuestion("")).toBe(false);
    expect(isQuestion("   ")).toBe(false);
    expect(isQuestion(" ? ")).toBe(false);
  });
});

describe("endsWithQuestion", () => {
  it("sees a question at the end in English and German", () => {
    expect(endsWithQuestion("Can you show me the next one?")).toBe(true);
    expect(endsWithQuestion("Kannst du das sehen? ")).toBe(true);
    expect(endsWithQuestion("Let me show you the next one.")).toBe(false);
    expect(endsWithQuestion("Das ist alles.")).toBe(false);
  });

  it("sees a question at the end in other scripts", () => {
    expect(endsWithQuestion("你看得到吗？")).toBe(true);
    expect(endsWithQuestion("見えますか？")).toBe(true);
    expect(endsWithQuestion("次の請求書を開きます。")).toBe(false);
    expect(endsWithQuestion("هل ترى ذلك؟")).toBe(true);
    expect(endsWithQuestion("آیا این را می‌بینی؟")).toBe(true);
    expect(endsWithQuestion("این فاکتور بعدی است.")).toBe(false);
    expect(endsWithQuestion("Ինչու՞")).toBe(true);
    expect(endsWithQuestion("Γιατί;")).toBe(true);
    expect(endsWithQuestion("Βλέπεις αυτό\u037E")).toBe(true);
    expect(endsWithQuestion("Αυτό είναι όλο.")).toBe(false);
    expect(endsWithQuestion("First the supplier; then the order;")).toBe(false);
  });

  it("only looks at the end of the line", () => {
    expect(endsWithQuestion("Warum? Egal.")).toBe(false);
    expect(isQuestion("Warum? Egal.")).toBe(true);
  });

  it("ignores empty lines", () => {
    expect(endsWithQuestion("")).toBe(false);
    expect(endsWithQuestion("   ")).toBe(false);
  });
});

describe("policyFrom", () => {
  const pace = (s: Partial<Pick<Settings, "curiosity" | "minQuestions" | "debriefDepth">>) =>
    policyFrom({ ...defaultSettings(), ...s });

  it("gives today's pace for the default settings", () => {
    expect(policyFrom(defaultSettings())).toEqual(DEFAULT_POLICY);
    expect(DEFAULT_POLICY).toEqual({
      minLive: 3,
      earlyGapMs: 40_000,
      gapMs: 75_000,
      minDebrief: 3,
    });
  });

  it("never asks fewer than the brief's 3 live and 3 debrief questions", () => {
    let combos = 0;
    for (const curiosity of ["quiet", "balanced", "curious"] as const)
      for (const minQuestions of ["3", "4", "5"] as const)
        for (const debriefDepth of ["short", "standard", "thorough"] as const) {
          const p = policyFrom({ curiosity, minQuestions, debriefDepth });
          expect(p.minLive).toBeGreaterThanOrEqual(3);
          expect(p.minLive).toBe(Number(minQuestions));
          expect(p.minDebrief).toBeGreaterThanOrEqual(3);
          expect(p.earlyGapMs).toBeGreaterThan(0);
          expect(p.gapMs).toBeGreaterThan(0);
          expect(Number.isInteger(p.earlyGapMs) && Number.isInteger(p.gapMs)).toBe(true);
          combos++;
        }
    expect(combos).toBe(27);
  });

  it("maps debrief depth to 3, 3 and 5 follow-ups", () => {
    expect(pace({ debriefDepth: "short" }).minDebrief).toBe(3);
    expect(pace({ debriefDepth: "standard" }).minDebrief).toBe(3);
    expect(pace({ debriefDepth: "thorough" }).minDebrief).toBe(5);
  });

  it("asks sooner when curious and later when quiet", () => {
    const curious = pace({ curiosity: "curious" });
    const quiet = pace({ curiosity: "quiet" });
    expect(curious).toMatchObject({ earlyGapMs: 26_400, gapMs: 49_500 });
    expect(quiet).toMatchObject({ earlyGapMs: 60_000, gapMs: 112_500 });

    // Early: one question 30 s ago, then 45 s ago.
    const after = (ms: number) => ({ ...ready, questionTimes: [ready.now - ms] });
    expect(decideFloor(after(30_000), curious)).toBe("ask");
    expect(decideFloor(after(30_000))).toBe("waiting");
    expect(decideFloor(after(45_000))).toBe("ask");
    expect(decideFloor(after(45_000), quiet)).toBe("waiting");
    expect(decideFloor(after(60_000), quiet)).toBe("ask");

    // After the minimum: three questions, the last 60 s ago, then 90 s ago.
    const late = (ms: number) => ({
      ...ready,
      questionTimes: [ready.now - 3 * MIN, ready.now - 2 * MIN, ready.now - ms],
    });
    expect(decideFloor(late(60_000), curious)).toBe("ask");
    expect(decideFloor(late(60_000))).toBe("waiting");
    expect(decideFloor(late(90_000))).toBe("ask");
    expect(decideFloor(late(90_000), quiet)).toBe("waiting");
    expect(decideFloor(late(120_000), quiet)).toBe("ask");
  });

  it("keeps the early pace and asks about what they opened until 5 questions with minLive 5", () => {
    const five = pace({ minQuestions: "5" });
    expect(five.minLive).toBe(5);
    const looked = { ...ready, pending: [{ at: 0, kind: "navigation" as const }] };
    const asked = (n: number) =>
      Array.from({ length: n }, (_, i) => ready.now - 45_000 - (n - 1 - i) * MIN);
    // Three asked, the last 45 s ago: the default has moved on to the longer gap and to actions only.
    expect(decideFloor({ ...ready, questionTimes: asked(3) })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: asked(3) }, five)).toBe("ask");
    expect(decideFloor({ ...looked, questionTimes: asked(3) })).toBe("quiet");
    expect(decideFloor({ ...looked, questionTimes: asked(4) }, five)).toBe("ask");
    // Five asked: the same as the default after three.
    expect(decideFloor({ ...ready, questionTimes: asked(5) }, five)).toBe("waiting");
    expect(decideFloor({ ...looked, questionTimes: asked(5) }, five)).toBe("quiet");
  });

  it("needs five debrief follow-ups when minDebrief is 5", () => {
    const four = ["a?", "b?", "c?", "d?"];
    expect(debriefStatus({ asked: four.slice(0, 3), gaps: [], minDebrief: 5 })).toEqual({
      met: false,
      remaining: 2,
      next: [],
    });
    expect(debriefStatus({ asked: four, gaps: [], minDebrief: 5 }).remaining).toBe(1);
    expect(debriefStatus({ asked: [...four, "e?"], gaps: [], minDebrief: 5 }).met).toBe(true);
    expect(debriefStatus({ asked: four.slice(0, 3), gaps: [] }).met).toBe(true);
  });

  it("falls back to each field's default for unknown values", () => {
    const bogus = policyFrom({
      curiosity: "chatty",
      minQuestions: "2",
      debriefDepth: "toString",
    } as unknown as Settings);
    expect(bogus).toEqual(DEFAULT_POLICY);
    expect(policyFrom({ ...defaultSettings(), minQuestions: "x" } as unknown as Settings)).toEqual(
      DEFAULT_POLICY,
    );
    expect(
      policyFrom({
        ...defaultSettings(),
        minQuestions: "1.5",
        curiosity: "quiet",
      } as unknown as Settings).minLive,
    ).toBe(3);
  });
});
