import argparse
import asyncio
import os
import sys

from storage.db_manager import DatabaseManager

from .handler_functions import (  # noqa: F401  (resolved by name from the flow)
    begin_observation,
    confirm_work_map,
    note_open_question,
    ready_to_teach_back,
    record_correction,
    record_guardrail,
    record_step,
    start_debrief,
)

from .interview_flow import InterviewFlow

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


async def main():
    parser = argparse.ArgumentParser(
        description="Sivera · Shaping the future of hiring through AI-driven pre-screening and interviews."
    )
    parser.add_argument("-u", "--url", type=str, help="Room URL", required=True)
    parser.add_argument("-t", "--token", type=str, help="Room token", required=True)
    parser.add_argument("-s", "--session_id", type=str, help="Session ID", required=True)
    parser.add_argument("-j", "--job_id", type=str, help="Job ID", required=False)
    parser.add_argument("-c", "--candidate_id", type=str, help="Candidate ID", required=False)

    args = parser.parse_args()
    db_manager = DatabaseManager()

    bot = InterviewFlow(
        url=args.url,
        bot_token=args.token,
        session_id=args.session_id,
        db_manager=db_manager,
        job_id=args.job_id,
        candidate_id=args.candidate_id,
    )
    await bot.start()


if __name__ == "__main__":
    asyncio.run(main())
