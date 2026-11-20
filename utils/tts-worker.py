"""Private stdin/stdout worker. Retains the most recently used neural voice."""
import base64
import gc
import json
import pathlib
import sys
from piper import PiperVoice

root = pathlib.Path(sys.argv[1])
allowed = {"en_US-ryan-medium", "nl_BE-nathalie-medium", "fr_FR-siwis-medium", "de_DE-thorsten-medium"}
voice = None
loaded = None
for line in sys.stdin:
    try:
        request = json.loads(line)
        model = request["model"]
        if model not in allowed:
            raise ValueError("Unsupported model")
        if model != loaded:
            voice = None
            loaded = None
            gc.collect()
            voice = PiperVoice.load(root / (model + ".onnx"))
            loaded = model
        audio = bytearray()
        if not request.get("warm"):
            for chunk in voice.synthesize(request["text"]):
                audio.extend(chunk.audio_int16_bytes)
                if len(audio) > 3 * 1024 * 1024:
                    raise ValueError("Audio too long")
        print(json.dumps({"audio": base64.b64encode(audio).decode("ascii")}), flush=True)
    except Exception:
        print(json.dumps({"error": "Synthesis failed"}), flush=True)
