/**
 * The languages the apprentice and the tutor can speak: every conversation language an
 * ElevenLabs agent accepts. Keep in sync with core/backend/src/services/languages.py.
 *
 * The expert picks one for the apprentice, the new hire one for the tutor. The Work Map
 * between them is in English, with the expert's words as they said them.
 */
import type { Language as AgentLanguage } from "@elevenlabs/client";

export type LanguageCode = AgentLanguage;
/** "auto": start in English and switch to whatever the person speaks first. */
export type LanguageChoice = LanguageCode | "auto";

// [code, English name, own name]
const LIST: [LanguageCode, string, string][] = [
  ["en", "English", "English"],
  ["de", "German", "Deutsch"],
  ["fr", "French", "Français"],
  ["es", "Spanish", "Español"],
  ["it", "Italian", "Italiano"],
  ["pt", "Portuguese", "Português"],
  ["pt-br", "Portuguese (Brazil)", "Português (Brasil)"],
  ["nl", "Dutch", "Nederlands"],
  ["pl", "Polish", "Polski"],
  ["cs", "Czech", "Čeština"],
  ["sk", "Slovak", "Slovenčina"],
  ["hu", "Hungarian", "Magyar"],
  ["ro", "Romanian", "Română"],
  ["bg", "Bulgarian", "Български"],
  ["hr", "Croatian", "Hrvatski"],
  ["sr", "Serbian", "Српски"],
  ["bs", "Bosnian", "Bosanski"],
  ["sl", "Slovenian", "Slovenščina"],
  ["mk", "Macedonian", "Македонски"],
  ["el", "Greek", "Ελληνικά"],
  ["tr", "Turkish", "Türkçe"],
  ["ru", "Russian", "Русский"],
  ["uk", "Ukrainian", "Українська"],
  ["be", "Belarusian", "Беларуская"],
  ["sv", "Swedish", "Svenska"],
  ["no", "Norwegian", "Norsk"],
  ["da", "Danish", "Dansk"],
  ["fi", "Finnish", "Suomi"],
  ["is", "Icelandic", "Íslenska"],
  ["et", "Estonian", "Eesti"],
  ["lv", "Latvian", "Latviešu"],
  ["lt", "Lithuanian", "Lietuvių"],
  ["ga", "Irish", "Gaeilge"],
  ["cy", "Welsh", "Cymraeg"],
  ["lb", "Luxembourgish", "Lëtzebuergesch"],
  ["ca", "Catalan", "Català"],
  ["gl", "Galician", "Galego"],
  ["af", "Afrikaans", "Afrikaans"],
  ["ar", "Arabic", "العربية"],
  ["he", "Hebrew", "עברית"],
  ["fa", "Persian", "فارسی"],
  ["ps", "Pashto", "پښتو"],
  ["ur", "Urdu", "اردو"],
  ["sd", "Sindhi", "سنڌي"],
  ["hi", "Hindi", "हिन्दी"],
  ["bn", "Bengali", "বাংলা"],
  ["pa", "Punjabi", "ਪੰਜਾਬੀ"],
  ["gu", "Gujarati", "ગુજરાતી"],
  ["mr", "Marathi", "मराठी"],
  ["ne", "Nepali", "नेपाली"],
  ["as", "Assamese", "অসমীয়া"],
  ["ta", "Tamil", "தமிழ்"],
  ["te", "Telugu", "తెలుగు"],
  ["kn", "Kannada", "ಕನ್ನಡ"],
  ["ml", "Malayalam", "മലയാളം"],
  ["zh", "Chinese", "中文"],
  ["ja", "Japanese", "日本語"],
  ["ko", "Korean", "한국어"],
  ["vi", "Vietnamese", "Tiếng Việt"],
  ["th", "Thai", "ไทย"],
  ["id", "Indonesian", "Bahasa Indonesia"],
  ["ms", "Malay", "Bahasa Melayu"],
  ["jv", "Javanese", "Basa Jawa"],
  ["tl", "Filipino", "Filipino"],
  ["hy", "Armenian", "Հայերեն"],
  ["ka", "Georgian", "ქართული"],
  ["az", "Azerbaijani", "Azərbaycanca"],
  ["kk", "Kazakh", "Қазақша"],
  ["ky", "Kyrgyz", "Кыргызча"],
  ["sw", "Swahili", "Kiswahili"],
  ["ha", "Hausa", "Hausa"],
  ["so", "Somali", "Soomaali"],
];

export const LANGUAGES = LIST.map(([code, english, own]) => ({ code, english, own }));

export const languageName = (code: string | null | undefined) =>
  LANGUAGES.find((l) => l.code === code)?.english ?? code ?? "";

/** Options for a picker: Auto first, then English, then the rest by English name. */
export const languageOptions = (withAuto: boolean) => [
  ...(withAuto ? [{ value: "auto" as LanguageChoice, label: "Auto-detect" }] : []),
  ...[...LANGUAGES]
    .sort((a, b) =>
      a.code === "en" ? -1 : b.code === "en" ? 1 : a.english.localeCompare(b.english),
    )
    .map((l) => ({
      value: l.code as LanguageChoice,
      label: l.english === l.own ? l.english : `${l.own} · ${l.english}`,
    })),
];

export const isLanguageChoice = (v: unknown): v is LanguageChoice =>
  v === "auto" || LANGUAGES.some((l) => l.code === v);

/** The language last chosen for a role, remembered on this machine. */
export function storedLanguage(role: "apprentice" | "tutor"): LanguageChoice {
  if (typeof localStorage === "undefined") return role === "apprentice" ? "auto" : "en";
  const v = localStorage.getItem(`tacit:language:${role}`);
  return isLanguageChoice(v) ? v : role === "apprentice" ? "auto" : "en";
}
export function storeLanguage(role: "apprentice" | "tutor", v: LanguageChoice) {
  localStorage.setItem(`tacit:language:${role}`, v);
}

/** A lesson as passed to the pill ("lesson:<ref>"): the Work Map id and the tutor's language. */
export const lessonRef = (workMapId: string, language: LanguageChoice) =>
  `${workMapId}@${language}`;
export function parseLessonRef(ref: string): { workMapId: string; language: LanguageChoice } {
  const [workMapId = "", language] = ref.split("@");
  return { workMapId, language: isLanguageChoice(language) ? language : "en" };
}
