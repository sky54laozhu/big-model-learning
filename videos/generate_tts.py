"""Generate TTS audio using SiliconFlow CosyVoice2 with cloned voice."""
import json
import sys
from pathlib import Path
from openai import OpenAI

API_KEY = "sk-ibwxtwyzaymevxcktryjsgykpwsxlkwkewaxsnqoznddagqi"
VOICE_URI = "speech:weifeng-voice:d8np95ucnncc739iap60:fyaeaourxgwasndpihbr"
MODEL = "FunAudioLLM/CosyVoice2-0.5B"

client = OpenAI(api_key=API_KEY, base_url="https://api.siliconflow.cn/v1")

script_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("scripts/blog01.json")
out_dir = Path("audio") / script_path.stem
out_dir.mkdir(parents=True, exist_ok=True)

segments = json.loads(script_path.read_text())

for seg in segments:
    out_file = out_dir / f"{seg['id']}.mp3"
    if out_file.exists():
        print(f"  skip {seg['id']} (exists)")
        continue
    print(f"  generating {seg['id']}... ", end="", flush=True)
    try:
        with client.audio.speech.with_streaming_response.create(
            model=MODEL,
            voice=VOICE_URI,
            input=seg["text"],
            response_format="mp3",
            speed=1.15,
        ) as response:
            response.stream_to_file(str(out_file))
        print("ok")
    except Exception as e:
        print(f"FAILED: {e}")

print(f"\nDone. Audio files in {out_dir}/")
