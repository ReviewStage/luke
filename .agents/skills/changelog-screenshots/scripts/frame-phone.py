# frame-phone.py <screen.png> <out.png> [cut] -- frames a simulator screen
# (phone.sh's alpha-masked capture) on the Golden Gate wallpaper at the
# changelog's height, the phone rising from the picture's foot.
#
# `cut` is the share of the screen cut from its foot, 0.114 by default, which
# is Safari's toolbar on an iPhone 17, so the browser's own address never
# shows. The wallpaper is the one scripts/changelog-screenshot.sh caches; run
# that once first. Needs Pillow.
import sys
from pathlib import Path

from PIL import Image, ImageFilter

HEIGHT = 1591
TOP = 110
WALLPAPER = Path(__file__).resolve().parents[4] / ".build/changelog-screenshot/golden-gate-sunset.png"

source, out = sys.argv[1], sys.argv[2]
cut = float(sys.argv[3]) if len(sys.argv) > 3 else 0.114
phone = Image.open(source).convert("RGBA")
phone = phone.crop((0, 0, phone.width, int(phone.height * (1 - cut))))
height = HEIGHT - TOP
width = int(phone.width * height / phone.height)
phone = phone.resize((width, height), Image.LANCZOS)
canvas = int(width * 1.75)
wall = Image.open(WALLPAPER).convert("RGB")
scale = max(canvas / wall.width, HEIGHT / wall.height)
wall = wall.resize((int(wall.width * scale) + 1, int(wall.height * scale) + 1), Image.LANCZOS)
left, top = (wall.width - canvas) // 2, (wall.height - HEIGHT) // 2
framed = wall.crop((left, top, left + canvas, top + HEIGHT)).convert("RGBA")
x = (canvas - width) // 2
shadow = Image.new("RGBA", (canvas, HEIGHT + 200), (0, 0, 0, 0))
shade = Image.new("RGBA", (width, height), (0, 0, 0, 0))
shade.putalpha(Image.eval(phone.getchannel("A"), lambda value: int(value * 0.6)))
shadow.paste(shade, (x, TOP + 22), shade)
framed = Image.alpha_composite(framed, shadow.filter(ImageFilter.GaussianBlur(30)).crop((0, 0, canvas, HEIGHT)))
framed.alpha_composite(phone, (x, TOP))
framed.convert("RGB").save(out)
print(out)
