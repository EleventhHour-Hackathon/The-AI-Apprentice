import asyncio
from datetime import datetime
import json
import os
import pathlib
from typing import Any, Dict, Optional
import uuid

import aiohttp

from dotenv import load_dotenv

from src.core.config import Config
from pipecat.audio.vad.silero import SileroVADAnalyzer, VADParams
from pipecat.frames.frames import BotInterruptionFrame, LLMMessagesAppendFrame
from pipecat.observers.base_observer import FramePushed
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.filters.stt_mute_filter import (
    STTMuteConfig,
    STTMuteFilter,
    STTMuteStrategy,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.processors.frameworks.rtvi import (
    RTVI_MESSAGE_LABEL,
    ActionResult,
    RTVIAction,
    RTVIActionArgument,
    RTVIConfig,
    RTVIMessageLiteral,
    RTVIObserver,
    RTVIProcessor,
    TransportMessageUrgentFrame,
)
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.transports.services.daily import DailyParams, DailyTransport
from pipecat_flows import FlowManager
from pydantic import BaseModel

from src.services.llm_factory import LLMFactory
from src.services.tts_factory import TTSFactory
from src.utils.logger import logger
from storage import work_maps as work_map_store

load_dotenv(override=True)


class InterviewRTVIProcessor(RTVIProcessor):
    async def interrupt_bot(self):
        logger.info("InterviewRTVIProcessor: Interrupting bot...")
        await super().interrupt_bot()
        logger.info("InterviewRTVIProcessor: BotInterruptionFrame pushed upstream")


class InterviewRTVIObserver(RTVIObserver):
    async def on_push_frame(self, data: FramePushed):
        if isinstance(data.frame, BotInterruptionFrame):
            logger.info(
                f"Bot interruption frame detected: {data.frame} from {data.source.__class__.__name__} to {data.destination.__class__.__name__}"
            )
        await super().on_push_frame(data)


rtvi_instance = None
interview__flow_instance = None


async def end_interview_pipeline():
    logger.info("end_interview_pipeline called - terminating interview session")
    if interview__flow_instance:
        logger.info("Calling stop() on interview flow instance")
        await interview__flow_instance.stop()
        logger.info("Interview flow instance stopped successfully")
    else:
        logger.warning("No interview flow instance found to stop")


class RTVISourcesMessage(BaseModel):
    """Model for sending sources to client via RTVI transport."""

    label: RTVIMessageLiteral = RTVI_MESSAGE_LABEL
    type: str = "server-message"
    data: Dict[str, Any]


async def send_message_to_client(message):
    """
    Send generic message to the client via RTVI transport.

    Args:
        message: Message data to send to client
    """
    if not rtvi_instance:
        logger.warning("Cannot send message: RTVI instance not set")
        return

    try:
        message_model = RTVISourcesMessage(data=message)
        logger.info("Sending message to client using model approach")
        await rtvi_instance.push_frame(
            TransportMessageUrgentFrame(message=message_model.model_dump()),
            FrameDirection.DOWNSTREAM,
        )
        logger.info("Message sent to client via RTVI")
    except Exception as e:
        logger.error(f"Error sending message to client: {str(e)}")


class InterviewFlow:
    def _load_session_profile(self):
        """Load the apprentice flow this session will run."""
        with open("src/services/flows/apprentice.json", "r") as f:
            self.flow_config = json.load(f)
        self.duration = 20

    def __init__(
        self,
        url,
        bot_token,
        session_id,
        db_manager,
        job_id=None,
        candidate_id=None,
        bot_name="Sia",
    ):
        self.url = url
        self.token = bot_token
        self.session_id = session_id
        self.job_id = job_id
        self.candidate_id = candidate_id
        self.bot_name = bot_name
        self.task: Optional[PipelineTask] = None
        self.runner: Optional[PipelineRunner] = None
        self.task_running = False
        self.db = db_manager
        # Remove time tracking functionality

        self._load_session_profile()

        logger.info(f"Flow config keys: {list(self.flow_config.keys())}")

        self.stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))
        self.tts = TTSFactory.create_tts_service()
        
        # Map provider names to configuration keys
        provider_config_map = {
            "elevenlabs": "elevenlabs",
            "cartesia": "cartesia", 
            "rime": "rime",
            "google": "google",
            "aws": "aws_polly"  # Map "aws" provider to "aws_polly" config key
        }
        
        provider = Config.TTS_CONFIG.get("provider", "elevenlabs")
        config_key = provider_config_map.get(provider, provider)
        tts_instructions = Config.TTS_CONFIG[config_key]["instructions"]
        
        self.llm = LLMFactory.create_llm_service()
        
        # Register cleanup handlers for proper resource management
        import atexit
        atexit.register(self._cleanup_resources)
        
        # Suppress nanobind warnings if configured
        if Config.SUPPRESS_NANOBIND_WARNINGS:
            import warnings
            warnings.filterwarnings("ignore", message="nanobind: leaked")
            logger.info("Nanobind warnings suppressed")

        # TODO: fetch the total time for this
        system_prompt = f"""

        IMPORTANT:
        Follow these instructions when speaking, as your replies are read aloud:
        {tts_instructions}

        HOW YOU SEE THE SCREEN:
        Messages that begin with [SCREEN] describe what is happening on the
        expert's screen right now. They are your own eyes, not speech from the
        expert. Never read one aloud, never repeat one back, and never tell the
        expert what you can see. Use them only to decide what is worth asking
        about, and to know whether the expert is busy or at a pause.

        A burst of [SCREEN] messages means they are mid-task, so stay silent.
        A gap in them, or the expert finishing a sentence, is your opening.

        NEVER:
        - Never interrupt the expert while they are typing, reading or talking.
        - Never ask something the screen has already told you.
        - Never evaluate, grade, score or praise their work. You are learning
          from them, not assessing them.
        - Never invent a reason or a rule they did not actually give you.
          If you are unsure, ask, or say that you are unsure.
        - Never talk about yourself or how you work: not what you can or
          cannot see, not screen sharing, the app, the session, AI or any
          other technology behind you. If the expert asks, answer in a few
          words and go straight back to their work.
        - Never pad a turn with filler, thanks, recaps or offers like
          "let me know if". Say the one thing that matters, then stop.
        """

        self._inject_dynamic_content_into_flow(system_prompt)

        context = OpenAILLMContext(
            messages=[
                {
                    "role": "system",
                    "content": system_prompt.strip(),
                },
            ]
        )
        self.context_aggregator = self.llm.create_context_aggregator(context)
        self.stt_mute_filter = STTMuteFilter(
            stt_service=self.stt,
            config=STTMuteConfig(strategies={STTMuteStrategy.MUTE_UNTIL_FIRST_BOT_COMPLETE}),
        )
        self.rtvi = InterviewRTVIProcessor(config=RTVIConfig(config=[]))
        globals()["rtvi_instance"] = self.rtvi
        globals()["interview__flow_instance"] = self
        self.rtvi_observer = InterviewRTVIObserver(rtvi=self.rtvi)
        self.flow_manager: Optional[FlowManager] = None

        @self.rtvi.event_handler("on_client_ready")
        async def on_client_ready(rtvi):
            await rtvi.set_bot_ready()
            if self.flow_manager and self.flow_manager.current_node:
                await send_message_to_client(
                    {"type": "flow.node", "node": self.flow_manager.current_node}
                )

        @self.rtvi.event_handler("on_client_message")
        async def on_client_message(_rtvi, message):
            try:
                await self._handle_client_message(message.type, message.data or {})
            except Exception as e:
                logger.error(f"Error handling client message {message.type}: {e}")

    @classmethod
    async def create(cls, url, bot_token, session_id, db_manager, job_id, bot_name="Sia"):
        return cls(url, bot_token, session_id, db_manager, job_id, bot_name)

    # Timer functionality removed to improve bot response time

    async def _handle_client_message(self, kind: str, data: Dict[str, Any]):
        """Act on the controls the expert presses in the voice pill.

        These move the flow directly instead of asking the LLM to, so pressing
        End or Later always does what it says.
        """
        if not self.flow_manager:
            return
        node = self.flow_manager.current_node

        if kind == "work.end" and node in ("session_start", "observing"):
            logger.info("Expert ended the work session, moving to the debrief")
            await self.rtvi.interrupt_bot()
            await self._go_to("debrief")

        elif kind == "question.later" and node in ("session_start", "observing"):
            from src.services.handler_functions import park_open_question  # noqa: PLC0415

            await self.rtvi.interrupt_bot()
            question = str(data.get("question") or "").strip()
            if question:
                await park_open_question(self.flow_manager, question)
            await self._append_context(
                "[EXPERT] Not now, I am busy. Keep that question for the debrief and stay quiet.",
                run_llm=False,
            )

        elif kind == "debrief.skip" and node == "debrief":
            await self._append_context(
                "[EXPERT] Skip that one. Ask your next question.", run_llm=True
            )

        else:
            logger.info(f"Ignoring client message {kind} in node {node}")

    async def _go_to(self, node: str):
        config = {"name": node, **self.flow_config["nodes"][node]}
        await self.flow_manager.set_node_from_config(config)
        await send_message_to_client({"type": "flow.node", "node": node})

    async def _append_context(self, content: str, run_llm: bool):
        if run_llm:
            await self.rtvi.interrupt_bot()
        await self.rtvi.push_frame(
            LLMMessagesAppendFrame(messages=[{"role": "user", "content": content}], run_llm=run_llm)
        )

    async def create_transport(self):
        self.aiohttp_session = aiohttp.ClientSession()

        self.transport = DailyTransport(
            room_url=self.url,
            token=self.token,
            bot_name=self.bot_name,
            params=DailyParams(
                # TODO: I don't see this contributing that much, or might need to finetune params.
                # turn_analyzer=FalSmartTurnAnalyzer(
                #     api_key=os.getenv("FAL_API_KEY"),
                #     aiohttp_session=self.aiohttp_session,
                #     params=SmartTurnParams(
                #         stop_secs=2,  # Time to wait after speech ends before considering turn complete
                #         pre_speech_ms=0.3,  # No delay before starting to process speech
                #         max_duration_secs=8.0,  # Maximum length of a single turn to maintain natural conversation
                #     ),
                # ),
                audio_out_enabled=True,
                audio_out_sample_rate=48000,
                audio_out_channels=1,
                audio_in_enabled=True,
                camera_out_enabled=True,
                camera_out_width=1024,
                camera_out_height=768,
                camera_out_framerate=30,
                vad_analyzer=SileroVADAnalyzer(
                    params=VADParams(
                        stop_secs=0.1,
                    ),
                ),
                audio_in_passthrough=True,
            ),
        )

        @self.transport.event_handler("on_joined")
        async def on_joined(_transport, _participant):
            logger.info(f"Bot joined the session: {self.session_id}")

        @self.transport.event_handler("on_call_state_updated")
        async def on_call_state_updated(_transport, state):
            logger.info(f"Call state updated: {state}")

        @self.transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(_transport, participant):
            if not self.task:
                return

            if not self.flow_manager:
                logger.error("Flow manager not initialized")
                return

            logger.info(f"First participant joined: {participant}")
            await self.flow_manager.initialize()
            pass

        @self.transport.event_handler("on_participant_left")
        async def on_participant_left(_transport, participant, reason):
            logger.info(f"Participant left: {participant}, reason: {reason}")
            await self.stop()

        @self.transport.event_handler("on_app_message")
        async def on_app_message(_transport, participant, message):
            try:
                if isinstance(participant, dict) and isinstance(message, str):
                    logger.info(f"Received app message from {message}: {participant}")
                    return

                if isinstance(message, dict):
                    if message.get("type") == "end_session":
                        logger.info("Received end_session command")

                        await self.stop()
                    elif message.get("msg") == "interrupt":
                        logger.info("Interrupt message received, triggering bot interruption")
                        try:
                            await self.rtvi.interrupt_bot()
                            logger.info("Bot interruption triggered successfully")
                        except Exception as e:
                            logger.error(f"Failed to interrupt bot: {e}")
                    elif message.get("event") == "request-chat-history":
                        logger.info("Chat history request received")
                    else:
                        logger.info(f"Unhandled message type: {message}")
            except Exception as e:
                logger.error(f"Error handling app message: {e}")

    async def create_pipeline(self):
        if not hasattr(self, "transport") or not self.transport:
            raise Exception("Transport not initialized")

        pipeline = Pipeline(
            [
                self.transport.input(),
                self.rtvi,
                self.stt_mute_filter,
                self.stt,
                self.context_aggregator.user(),
                self.llm,
                self.tts,
                self.transport.output(),
                self.context_aggregator.assistant(),
            ]
        )

        self.task = PipelineTask(
            pipeline=pipeline,
            params=PipelineParams(
                allow_interruptions=True,  # Enable bot interruption for more natural conversation
                auto_enable_processors=True,  # Automatically enable all processors
                stream_processing=True,  # Process audio in real-time streams
                parallel_processing=True,  # Enable parallel processing of frames
                buffer_size=2048,  # Larger buffer for smoother audio processing
                max_queue_size=50,  # Smaller queue for faster processing of frames
                processing_timeout=5.0,  # Overall timeout for processing pipeline
                error_handling="retry",  # Automatically retry on processing errors
            ),
            observers=[self.rtvi_observer],
            cancel_timeout_secs=30,  # Allow 30 seconds for graceful cancellation
        )

        # Ensure flow_config is available before creating FlowManager
        if not hasattr(self, 'flow_config') or self.flow_config is None:
            logger.error("flow_config is not available, cannot create FlowManager")
            raise ValueError("flow_config is required for FlowManager initialization")
        
        logger.info(f"Creating FlowManager with flow_config: {type(self.flow_config)}")
        
        self.flow_manager = FlowManager(
            task=self.task,
            llm=self.llm,
            context_aggregator=self.context_aggregator,
            tts=self.tts,
            flow_config=self.flow_config,
        )

        async def handle_append_to_messages(
            _rtvi: RTVIProcessor, _service: str, arguments: Dict[str, Any]
        ) -> ActionResult:
            if "messages" in arguments and arguments["messages"]:
                for msg in arguments["messages"]:
                    self.context_aggregator.user()._context.messages.append(msg)
                print("Current context:", self.flow_manager.get_current_context())
                return True
            else:
                return False

        self.append_to_messages_action = RTVIAction(
            service="llm",
            action="append_to_messages",
            arguments=[
                RTVIActionArgument(name="messages", type="array"),
            ],
            result="bool",
            handler=handle_append_to_messages,
        )
        self.rtvi.register_action(self.append_to_messages_action)
        return self.task

    async def start(self):
        if self.runner and self.task_running:
            logger.warning("Runner is already running")
            return

        await self.create_transport()
        await self.create_pipeline()

        self.runner = PipelineRunner()

        try:
            logger.info("Starting interview flow pipeline...")
            logger.info(f"- Allow interruptions: {self.task.params.allow_interruptions}")
            logger.info(f"- STT mute strategy: {self.stt_mute_filter._config.strategies}")

            logger.info(f"Starting interview flow for session {self.session_id}")

            await self.runner.run(self.task)
            self.task_running = True

            logger.info(f"Interview flow pipeline finished for session {self.session_id}")
            # The flow can end itself after the teach-back, without stop() ever running.
            self._save_work_map()

        except Exception as e:
            logger.error(f"Failed to start interview flow: {e}")
            if self.runner:
                self.task_running = False

            logger.info("Attempting to restart pipeline after error...")

            try:
                self.task = PipelineTask(
                    pipeline=self.task.pipeline,
                    params=self.task.params,
                    observers=[self.rtvi_observer],
                    cancel_timeout_secs=30,  # Allow 30 seconds for graceful cancellation
                )
                await self.runner.run(self.task)
                self.task_running = True
            except Exception as recovery_error:
                logger.error(f"Failed to recover pipeline: {recovery_error}")
                raise RuntimeError(f"Failed to start interview flow: {e}") from None

    def _save_work_map(self):
        """Write out what the apprentice learned, so the session outlives it.

        Holds the steps, the judgment behind them and the guardrails, each
        tied back to the screen moment it came from, plus the transcript the
        reasons were quoted from. Goes to Supabase (storage/work_maps.py).
        """
        try:
            state = getattr(getattr(self, "flow_manager", None), "state", {}) or {}
            work_map = state.get("work_map")
            if not work_map:
                logger.info("No work map captured this session")
                return

            work_map = dict(work_map)
            work_map["session_id"] = self.session_id
            work_map["recorded_at"] = datetime.now().isoformat()

            transcript = []
            flow_manager = getattr(self, "flow_manager", None)
            if flow_manager and hasattr(flow_manager, "get_current_context"):
                for message in flow_manager.get_current_context() or []:
                    if isinstance(message, dict) and message.get("role") in ("user", "assistant"):
                        transcript.append(
                            {"role": message["role"], "content": message.get("content", "")}
                        )
            work_map["transcript"] = transcript

            try:
                work_map_store.save(work_map)
                saved_to = "Supabase"
            except Exception as e:
                # Keep the session rather than lose it; this file is not listed in the app.
                logger.error(f"Couldn't save Work Map to Supabase, writing it locally: {e}")
                out_dir = pathlib.Path("uploads/work_maps")
                out_dir.mkdir(parents=True, exist_ok=True)
                out_file = out_dir / f"{self.session_id}.json"
                out_file.write_text(json.dumps(work_map, indent=2, default=str))
                saved_to = str(out_file)

            logger.info(
                f"Work Map saved to {saved_to}: {len(work_map.get('steps', []))} steps, "
                f"{len(work_map.get('guardrails', []))} guardrails, "
                f"confirmed={work_map.get('confirmed', False)}"
            )
        except Exception as e:
            logger.error(f"Failed to save work map: {e}")

    async def stop(self):
        try:
            interview_end_time = datetime.now()
            logger.info("Stopping interview session")

            self._save_work_map()

            if self.task:
                logger.info("Canceling pipeline task")
                try:
                    await self.task.cancel()
                    logger.info("Pipeline task cancelled successfully")
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error(f"Error cancelling pipeline task: {e}")
                finally:
                    self.task = None
                    self.task_running = False

            if hasattr(self, "aiohttp_session"):
                await self.aiohttp_session.close()

            # Clean up audio resources to prevent nanobind memory leaks
            if hasattr(self, "tts") and self.tts:
                try:
                    if hasattr(self.tts, "close"):
                        await self.tts.close()
                    elif hasattr(self.tts, "__del__"):
                        del self.tts
                    logger.info("TTS service cleaned up")
                except Exception as e:
                    logger.warning(f"Error cleaning up TTS service: {e}")

            if hasattr(self, "stt") and self.stt:
                try:
                    if hasattr(self.stt, "close"):
                        await self.stt.close()
                    elif hasattr(self.stt, "__del__"):
                        del self.stt
                    logger.info("STT service cleaned up")
                except Exception as e:
                    logger.warning(f"Error cleaning up STT service: {e}")

            # Clean up pipeline runner
            if hasattr(self, "runner") and self.runner:
                try:
                    if hasattr(self.runner, "close"):
                        await self.runner.close()
                    elif hasattr(self.runner, "__del__"):
                        del self.runner
                    logger.info("Pipeline runner cleaned up")
                except Exception as e:
                    logger.warning(f"Error cleaning up pipeline runner: {e}")

            # Force garbage collection to clean up any remaining references
            import gc
            gc.collect()

        except Exception as e:
            logger.error(f"Error stopping interview flow: {e}")

    def _cleanup_resources(self):
        """
        Cleanup method called by atexit to ensure resources are properly released.
        This helps prevent nanobind memory leaks.
        """
        try:
            # Clean up TTS service
            if hasattr(self, "tts") and self.tts:
                try:
                    if hasattr(self.tts, "__del__"):
                        del self.tts
                    self.tts = None
                except Exception as e:
                    logger.warning(f"Error in TTS cleanup: {e}")

            # Clean up STT service
            if hasattr(self, "stt") and self.stt:
                try:
                    if hasattr(self.stt, "__del__"):
                        del self.stt
                    self.stt = None
                except Exception as e:
                    logger.warning(f"Error in STT cleanup: {e}")

            # Clean up pipeline runner
            if hasattr(self, "runner") and self.runner:
                try:
                    if hasattr(self.runner, "__del__"):
                        del self.runner
                    self.runner = None
                except Exception as e:
                    logger.warning(f"Error in runner cleanup: {e}")

            # Force garbage collection
            import gc
            gc.collect()
            
        except Exception as e:
            logger.warning(f"Error in resource cleanup: {e}")

    def _inject_dynamic_content_into_flow(self, context):
        """
        Inject dynamic content (candidate name, job title, resume) into flow config role_messages.
        """
        if not self.flow_config or not isinstance(self.flow_config, dict):
            return

        # Iterate through all nodes in the flow config
        nodes = self.flow_config.get("nodes", {})
        for node_name, node_config in nodes.items():
            role_messages = node_config.get("role_messages", [])

            for message in role_messages:
                if message.get("role") == "system":
                    # Append candidate context to existing system message
                    original_content = message.get("content", "")
                    message["content"] = original_content + context

        logger.info("Dynamic content injected into flow config")
