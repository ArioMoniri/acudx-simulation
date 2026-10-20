"""Voice adapters, profiles and routes (docs/architecture/18-voice-and-video-call.md).

* ``server.voice.base``       request/result dataclasses and the adapter protocols
* ``server.voice.adapters``   ``elevenlabs``, ``deepgram``, ``openai_compatible``
* ``server.voice.profiles``   patient sex + age band + language -> provider voice id
* ``server.voice.service``    registry resolution, GPU worker fallback, telemetry
* ``server.voice.livekit``    room tokens for the realtime video-call path
* ``server.voice.routes``     ``/v1/voice/tts``, ``/v1/voice/stt``, ``/v1/voice/capabilities``
"""
