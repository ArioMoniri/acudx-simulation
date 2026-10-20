"""Live patient video (docs/architecture/18 section 6).

* ``server.voice.avatar.sessions``  in-memory call sessions (case state, worker session, Tavus ids)
* ``server.voice.avatar.musetalk``  self-hosted path: the GPU worker's LiveTalking + MuseTalk 1.5
                                    runner behind Caddy at ``/avatar/*`` (WebRTC offer/answer,
                                    audio in, TURN credentials)
* ``server.voice.avatar.tavus``     hosted path: Tavus CVI (PAL per call with our own LLM)
* ``server.voice.avatar.routes``    ``/v1/voice/avatar/*`` and ``/v1/patient/openai/chat/completions``
"""
