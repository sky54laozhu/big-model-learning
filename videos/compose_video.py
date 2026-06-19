"""Compose Blog 01 video: TTS audio + SVG visuals + 3B1B clips via ffmpeg + Pillow."""
import json
import subprocess
import sys
import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
BG = (26, 34, 51)  # dark blue
BLOG_DIR = Path("../blogs/assets/img")
CLIP_DIR = Path("clips")
AUDIO_DIR = Path("audio/blog01")
SCRIPT = json.loads(Path("scripts/blog01.json").read_text())
TMP = Path("tmp_compose")
TMP.mkdir(exist_ok=True)
OUT = Path("output")
OUT.mkdir(exist_ok=True)


def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True
    )
    return float(r.stdout.strip())


def find_cjk_font():
    """Find a CJK font on macOS."""
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return p
    return None


FONT_PATH = find_cjk_font()


def make_text_image(text, out_png, font_size=36, max_chars=26, color=(221, 238, 255)):
    """Render full Chinese text to a PNG image using Pillow."""
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    if FONT_PATH:
        font = ImageFont.truetype(FONT_PATH, font_size)
    else:
        font = ImageFont.load_default()
    lines = textwrap.wrap(text, width=max_chars)
    # Auto-shrink if too many lines
    while len(lines) * (font_size + 12) > H - 100 and font_size > 20:
        font_size -= 2
        if FONT_PATH:
            font = ImageFont.truetype(FONT_PATH, font_size)
        lines = textwrap.wrap(text, width=max_chars + 4)
    line_height = font_size + 14
    total_h = len(lines) * line_height
    y_start = (H - total_h) // 2
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (W - tw) // 2
        draw.text((x, y_start + i * line_height), line, fill=color, font=font)
    img.save(out_png)


def make_title_image(text, out_png):
    """Render title card."""
    make_text_image(text, out_png, font_size=52, max_chars=18, color=(255, 255, 255))


PAD = 0.2  # seconds of silence/freeze between segments

def image_to_video(image_path, audio_path, out_path):
    """Create video from static image + audio, with tail padding."""
    dur = get_duration(audio_path) + PAD
    subprocess.run([
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(image_path),
        "-i", str(audio_path),
        "-af", f"apad=pad_dur={PAD}",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "25", "-bf", "0",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(dur),
        str(out_path)
    ], capture_output=True, check=True)


def svg_to_png(svg_path, png_path, width=1000):
    subprocess.run(["rsvg-convert", "-w", str(width), str(svg_path), "-o", str(png_path)], check=True)


def make_svg_frame(svg_name, out_png):
    """Convert SVG to a 1280x720 frame with dark background."""
    raw_png = TMP / f"{svg_name}_raw.png"
    svg_to_png(BLOG_DIR / f"{svg_name}.svg", raw_png, width=1100)
    fg = Image.open(raw_png)
    bg = Image.new("RGB", (W, H), BG)
    # Center the SVG
    x = (W - fg.width) // 2
    y = (H - fg.height) // 2
    bg.paste(fg, (x, max(y, 20)), fg if fg.mode == "RGBA" else None)
    bg.save(out_png)


def make_clip_segment(clip_name, audio_path, out_path):
    """3B1B clip: TTS voiceover first, then clip audio."""
    clip_file = CLIP_DIR / f"{clip_name}.mp4"
    tts_dur = get_duration(audio_path)
    clip_dur = get_duration(clip_file)

    subprocess.run([
        "ffmpeg", "-y",
        "-i", str(clip_file),
        "-i", str(audio_path),
        "-filter_complex", (
            f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x1a2233[v];"
            f"[0:a]volume=0:enable='lt(t,{tts_dur})',volume=1:enable='gte(t,{tts_dur})'[ca];"
            f"[1:a]apad=pad_dur=0[tts];"
            f"[ca][tts]amix=inputs=2:duration=longest:dropout_transition=2[a]"
        ),
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(clip_dur),
        str(out_path)
    ], capture_output=True, check=True)


def make_clip_voice_segment(clip_name, start, end, audio_path, out_path):
    """3B1B clip slice with TTS voiceover. Single-pass, no intermediate file.
    Uses trim filter for frame-accurate extraction, -bf 0 to prevent B-frame delay."""
    clip_file = CLIP_DIR / f"{clip_name}.mp4"
    tts_dur = get_duration(audio_path)
    clip_dur = end - start
    total_dur = tts_dur + PAD

    if tts_dur <= clip_dur:
        # TTS fits within clip: trim to tts+pad length
        trim_end = start + total_dur
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(clip_file),
            "-i", str(audio_path),
            "-filter_complex", (
                f"[0:v]trim=start={start}:end={trim_end},setpts=PTS-STARTPTS,"
                f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x1a2233[v];"
                f"[1:a]apad=pad_dur={PAD}[a]"
            ),
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-bf", "0",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(total_dur),
            str(out_path)
        ], capture_output=True, check=True)
    else:
        # TTS longer than clip: slow down video to fill
        speed = clip_dur / total_dur
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(clip_file),
            "-i", str(audio_path),
            "-filter_complex", (
                f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,"
                f"setpts={1/speed}*PTS,"
                f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x1a2233[v];"
                f"[1:a]apad=pad_dur={PAD}[a]"
            ),
            "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-bf", "0",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(total_dur),
            str(out_path)
        ], capture_output=True, check=True)


# --- Build segments ---
segment_files = []
for i, seg in enumerate(SCRIPT):
    audio = AUDIO_DIR / f"{seg['id']}.mp3"
    out = TMP / f"seg_{i:02d}_{seg['id']}.mp4"
    visual = seg["visual"]
    print(f"[{i+1}/{len(SCRIPT)}] {seg['id']} ({visual})... ", end="", flush=True)

    try:
        if visual == "title":
            title_png = TMP / f"{seg['id']}_title.png"
            make_title_image(seg["text"][:30], title_png)
            image_to_video(title_png, audio, out)
        elif visual.startswith("svg:"):
            svg_name = visual.split(":", 1)[1]
            frame_png = TMP / f"{svg_name}_frame.png"
            make_svg_frame(svg_name, frame_png)
            image_to_video(frame_png, audio, out)
        elif visual.startswith("clip_voice:"):
            parts = visual.split(":")
            clip_name = parts[1]
            clip_start = int(parts[2])
            clip_end = int(parts[3])
            make_clip_voice_segment(clip_name, clip_start, clip_end, audio, out)
        elif visual.startswith("clip:"):
            clip_name = visual.split(":", 1)[1]
            make_clip_segment(clip_name, audio, out)
        else:  # text_slide
            slide_png = TMP / f"{seg['id']}_slide.png"
            make_text_image(seg["text"], slide_png)
            image_to_video(slide_png, audio, out)
        segment_files.append(out)
        print("ok")
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode()[-500:] if e.stderr else "none"
        print(f"FAILED\n  stderr: {stderr}")
        sys.exit(1)

# --- Concatenate ---
print("\nConcatenating all segments...")
concat_list = TMP / "concat.txt"
concat_list.write_text("\n".join(f"file '{f.resolve()}'" for f in segment_files))

final = OUT / "blog01-what-is-llm.mp4"
subprocess.run([
    "ffmpeg", "-y", "-f", "concat", "-safe", "0",
    "-i", str(concat_list),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-bf", "0", "-preset", "fast",
    "-c:a", "aac", "-b:a", "192k", "-ar", "24000", "-ac", "1",
    str(final)
], check=True)

dur = get_duration(final)
size_mb = final.stat().st_size / 1024 / 1024
print(f"\nDone! {final} ({dur:.0f}s, {size_mb:.1f}MB)")
