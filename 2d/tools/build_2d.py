"""Build the 2.5D layers from the front art (ref_front.png, 1024px) and the sleeping art.
out/: base.webp (character, transparent bg, eyes/brows/mouth removed), eye_l/eye_r/brow_l/brow_r/mouth.webp sprites,
      sleep.webp (sleeping art, black bg turned transparent, glow kept as soft alpha)."""
import os, json, sys
import numpy as np, cv2
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
from PIL import ImageFilter
# the front view is cut from the 4-view sheet (~450 px) and enlarged; a mild unsharp mask brings the edges back
src = np.asarray(Image.open('ref_front.png').convert('RGB').filter(ImageFilter.UnsharpMask(radius=2.2, percent=60, threshold=2))).astype(np.float32)
H, W = src.shape[:2]

# ---------------------------------------------------------------- 1. alpha from the white background
mn = src.min(2); sat = src.max(2) - mn
bgc = ((mn >= 236) & (sat <= 14)).astype(np.uint8)
ff = np.zeros((H + 2, W + 2), np.uint8)
bg = np.zeros((H, W), np.uint8)
for sx, sy in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (W // 2, H - 1), (0, H // 2), (W - 1, H // 2)]:
    if bgc[sy, sx]:
        m = bgc.copy(); cv2.floodFill(m, ff, (sx, sy), 2)
        bg |= (m == 2)
fg = 1 - bg
# the white ear cup touches the white background: keep everything inside its outline
yy0, xx0 = np.mgrid[0:H, 0:W]
cup = (((xx0 - 859) / 67.0) ** 2 + ((yy0 - 571) / 119.0) ** 2) < 1
fg[cup] = 1; bg[cup] = 0
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# soft edge: estimate alpha in a 3px band from how far the pixel is from white
band = cv2.dilate(fg, np.ones((5, 5), np.uint8)) - cv2.erode(fg, np.ones((5, 5), np.uint8))
inner = cv2.erode(fg, np.ones((9, 9), np.uint8)).astype(bool)
# typical edge colour of the character nearby: blur of inner colours
acc = cv2.GaussianBlur(src * inner[..., None], (0, 0), 6); wgt = cv2.GaussianBlur(inner.astype(np.float32), (0, 0), 6)
fgc = acc / np.maximum(wgt[..., None], 1e-3)
dist_w = (255 - src).max(2); dist_f = np.maximum((255 - fgc).max(2), 30)
a_est = np.clip(dist_w / dist_f, 0, 1)
alpha = np.where(band > 0, a_est, fg.astype(np.float32))
alpha = cv2.GaussianBlur(alpha, (0, 0), 0.6)
alpha[bg.astype(bool) & (band == 0)] = 0
# un-mix white from edge colours
a3 = np.maximum(alpha, 1e-3)[..., None]
col = np.where(alpha[..., None] > 0.02, (src - (1 - alpha[..., None]) * 255) / a3, src)
col = np.clip(col, 0, 255)

# ---------------------------------------------------------------- 2. face features
F = {
    'eye_l': dict(c=(330, 562), r=(49, 61), pad=30),
    'eye_r': dict(c=(623, 553), r=(50, 61), pad=30),
    'brow_l': dict(c=(312, 429), r=(40, 21), pad=8),
    'brow_r': dict(c=(620, 412), r=(41, 18), pad=8),
    'mouth': dict(c=(478, 638), r=(62, 36), pad=14),
}
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
def ell(c, r):
    return np.sqrt(((xx - c[0]) / r[0]) ** 2 + ((yy - c[1]) / r[1]) ** 2)

def sprite(name, f):
    c, r, pad = f['c'], f['r'], f['pad']
    e = ell(c, (r[0] + pad, r[1] + pad))
    edge = pad / (min(r) + pad)
    a = np.clip((1 - e) / edge, 0, 1)            # 1 inside the feature, fading over `pad` px
    a = a * a * (3 - 2 * a)
    x0, x1 = int(c[0] - r[0] - pad - 2), int(c[0] + r[0] + pad + 3)
    y0, y1 = int(c[1] - r[1] - pad - 2), int(c[1] + r[1] + pad + 3)
    rgba = np.dstack([col[y0:y1, x0:x1], (a[y0:y1, x0:x1] * 255)]).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, name + '.webp'), lossless=True)
    return dict(x=x0, y=y0, w=x1 - x0, h=y1 - y0, cx=c[0], cy=c[1], rx=r[0], ry=r[1])

layout = {name: sprite(name, f) for name, f in F.items()}

# erase: harmonic fill (smooth skin shading continued from the border of each hole)
hole = np.zeros((H, W), bool)
for f in F.values():
    hole |= ell(f['c'], (f['r'][0] + f['pad'] * 0.75, f['r'][1] + f['pad'] * 0.75)) < 1
for (dx, dy) in [(426, 608), (526, 604)]:   # mouth-corner dimples, so drawn mouths do not keep them
    hole |= ((xx - dx) ** 2 + (yy - dy) ** 2) < 12 ** 2
fill = cv2.inpaint(col.astype(np.uint8), hole.astype(np.uint8), 5, cv2.INPAINT_TELEA).astype(np.float32)
ys, xs = np.where(hole); y0, y1, x0, x1 = ys.min() - 2, ys.max() + 3, xs.min() - 2, xs.max() + 3
sub = fill[y0:y1, x0:x1].copy(); hm = hole[y0:y1, x0:x1]
for it in range(2500):
    avg = (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1)) / 4
    sub[hm] = avg[hm]
fill[y0:y1, x0:x1] = sub
base = np.where(hole[..., None], fill, col)
# a whisper of grain so the filled skin does not look flatter than the rest
rng = np.random.default_rng(1)
base = np.where(hole[..., None], base + rng.normal(0, 0.6, base.shape), base)
rgba = np.dstack([np.clip(base, 0, 255), alpha * 255]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'base.webp'), quality=92, method=6)
Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, '_base_check.png'))
# skin colour next to each eye (for drawn eyelids)
layout['skin'] = [int(v) for v in base[470, 470]]

# ---------------------------------------------------------------- 3. sleeping art: black -> transparent, glow kept
s = np.asarray(Image.open('sleep_src.png').convert('RGB')).astype(np.float32)
mx = s.max(2) / 255
R, G, B = s[..., 0], s[..., 1], s[..., 2]
yy2 = np.mgrid[0:s.shape[0], 0:s.shape[1]][0]
# the glow is a dim, fixed yellow (B/R ~ 0.45, R < 249); the character is either fully bright (R >= 249),
# cream / white / grey (B/R > 0.6) or green
xx2 = np.mgrid[0:s.shape[0], 0:s.shape[1]][1]
bright = (R >= 249)
# the hood outline is fully bright; whitish glow above it must not count, so cream/white only counts below the
# top of the bright hood in each column
top = np.where(bright.any(0), bright.argmax(0), s.shape[0]).astype(np.float32)
top = cv2.erode(top[None, :], np.ones((1, 41), np.float32))[0]   # a little wider than the hood itself
cream = (B / np.maximum(R, 1) > 0.6) & (mx > 0.72) & (yy2 < 992) & (yy2 > top[None, :] + 4)
green = (G > R) & (mx > 0.4) & ~((xx2 > 1120) & (yy2 < 760))      # the leaf and the ear cup, not the green halo
solid = bright | cream | green
solid = cv2.morphologyEx(solid.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(solid, 8)
big = np.isin(lab, 1 + np.where(st[1:, cv2.CC_STAT_AREA] > 1500)[0]).astype(np.uint8)   # body, hands, leaf...
big = cv2.morphologyEx(big, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
cnts, _ = cv2.findContours(big, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
body = np.zeros_like(big); cv2.drawContours(body, cnts, -1, 1, -1)
body = cv2.GaussianBlur(body.astype(np.float32), (0, 0), 1.0)
sa = np.maximum(mx, body)
# the glow reaches the top of the picture: fade the glow (not the character) out near every edge
hh, ww = sa.shape
ey = np.minimum(np.arange(hh), hh - 1 - np.arange(hh))[:, None].astype(np.float32)
ex = np.minimum(np.arange(ww), ww - 1 - np.arange(ww))[None, :].astype(np.float32)
edge = np.clip(np.minimum(ey, ex) / 160.0, 0, 1); edge = edge * edge * (3 - 2 * edge)
glow_only = 1 - body
sa = sa * (1 - glow_only * (1 - edge))
sc = s / np.maximum(sa[..., None], 1e-3)
ys, xs = np.where(sa > 0.03)
x0, x1, y0, y1 = max(xs.min() - 4, 0), min(xs.max() + 5, s.shape[1]), max(ys.min() - 4, 0), min(ys.max() + 5, s.shape[0])
srgba = np.dstack([np.clip(sc, 0, 255), sa * 255]).astype(np.uint8)[y0:y1, x0:x1]
im = Image.fromarray(srgba, 'RGBA')
k = 900 / max(im.size); im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
im.save(os.path.join(OUT, 'sleep.webp'), quality=90, method=6)
layout['sleep'] = dict(w=im.width, h=im.height, crop=[int(x0), int(y0), int(x1), int(y1)], k=k)
json.dump(layout, open(os.path.join(OUT, 'layout.json'), 'w'), indent=1)
print(json.dumps(layout))
for fn in sorted(os.listdir(OUT)): print(fn, os.path.getsize(os.path.join(OUT, fn)))
