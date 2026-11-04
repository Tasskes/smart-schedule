"""Генерирует иконки приложения (PNG) без внешних файлов."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def icon(size, pad_ratio=0.0, rounded=True):
    scale = 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # фон-градиент
    top, bottom = (99, 102, 241), (79, 70, 229)
    grad = Image.new('RGBA', (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / s
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (s, y)], fill=c)
    mask = Image.new('L', (s, s), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    else:
        md.rectangle([0, 0, s, s], fill=255)
    img.paste(grad, (0, 0), mask)
    inner = s * (1 - 2 * pad_ratio)
    off = s * pad_ratio
    def P(x, y):
        return (off + x * inner, off + y * inner)
    # «лист календаря»
    w = int(inner * 0.045)
    d.rounded_rectangle([*P(0.2, 0.26), *P(0.8, 0.8)], radius=int(inner * 0.08), fill=(255, 255, 255, 255))
    d.rectangle([*P(0.2, 0.26), *P(0.8, 0.4)], fill=(224, 231, 255, 255))
    d.rounded_rectangle([*P(0.2, 0.26), *P(0.8, 0.42)], radius=int(inner * 0.08), outline=None)
    for x in (0.34, 0.66):
        d.rounded_rectangle([*P(x - 0.03, 0.18), *P(x + 0.03, 0.32)], radius=int(inner * 0.03), fill=(255, 255, 255, 255))
    # галочка
    d.line([P(0.34, 0.6), P(0.46, 0.71), P(0.68, 0.5)], fill=(79, 70, 229, 255), width=w * 2, joint='curve')
    # «искра» ИИ
    cx, cy = P(0.78, 0.24)
    r = inner * 0.09
    d.polygon([(cx, cy - r), (cx + r * 0.28, cy - r * 0.28), (cx + r, cy), (cx + r * 0.28, cy + r * 0.28),
               (cx, cy + r), (cx - r * 0.28, cy + r * 0.28), (cx - r, cy), (cx - r * 0.28, cy - r * 0.28)],
              fill=(253, 224, 71, 255))
    return img.resize((size, size), Image.LANCZOS)

icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, pad_ratio=0.1, rounded=False).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180, rounded=False).save(os.path.join(OUT, 'apple-touch-icon.png'))
print('ok')
