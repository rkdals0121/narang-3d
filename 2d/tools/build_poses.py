"""Pose layers for narang2d.js.
Input : raw/<pose>.png  (1264 px, white background; generated in the same style as the original art)
Output: <out>/poses/<pose>.webp (transparent) and <out>/poses.json with every pose placed in the art space of the
        original front view (1024 px frame: eyes centred on x=476, feet on y=958), plus the eyes (for blinking),
        the moving limbs and the glow points.
Usage : python build_poses.py <raw dir> <out dir>"""
import os, sys, json
import numpy as np, cv2
from PIL import Image

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(OUT, 'poses'), exist_ok=True)
S = 0.91                     # generated art is ~10 % larger than the original (eye height 67 vs 61 px)
ART_CX, ART_FEET = 476, 958  # eyes midpoint x and feet y of the original front view
BODY_H = 210                 # original: hood bottom (y 748) to feet

# everything below in raw px of the generated images (measured on a grid)
P = {
  'wave': dict(cx=611, feet=1167,
    eyes=[(445, 619, 54, 67), (778, 614, 55, 67)], neck=(590, 870),
    limbs=[dict(c=(232, 787), r=(125, 120), pivot=(405, 905), kind='rot', amp=0.27, hz=2.3)],
    headset=(1095, 646), heart=(604, 934)),
  'cheer': dict(cx=590, feet=1200,
    eyes=[], neck=(600, 875),
    limbs=[dict(c=(148, 737), r=(130, 125), pivot=(370, 905), kind='rot', amp=0.11, hz=1.7, phase=0),
           dict(c=(1110, 752), r=(130, 125), pivot=(850, 905), kind='rot', amp=-0.11, hz=1.7, phase=0)],
    headset=(1053, 618)),
  'point': dict(cx=577, feet=1215,
    eyes=[(415, 636, 52, 66), (739, 603, 53, 67)], neck=(610, 880),
    limbs=[dict(c=(1068, 815), r=(120, 110), pivot=(880, 880), kind='poke', amp=12, hz=1.6, dir=(1, -0.12))],
    headset=(1032, 604)),
  'think': dict(cx=575, feet=1156,
    eyes=[(412, 629, 53, 67), (741, 640, 63, 69)], neck=(610, 905),
    limbs=[], headset=(1074, 702), tilt=0.035),
  'surprise': dict(cx=589, feet=1200,
    eyes=[(416, 656, 58, 76), (763, 649, 61, 77)], neck=(590, 905),
    limbs=[], headset=(1095, 674)),
}

def to_art(x, y, p): return [round((x - p['cx']) * S + ART_CX, 1), round((y - p['feet']) * S + ART_FEET, 1)]

def cutout(a):
    """alpha from the white background (flood fill from the corners) with a soft, white-free edge"""
    a = a.astype(np.float32); mn = a.min(2); sat = a.max(2) - mn
    bgc = ((mn >= 238) & (sat <= 12)).astype(np.uint8); H, W = bgc.shape
    ff = np.zeros((H + 2, W + 2), np.uint8); m = bgc.copy()
    for pt in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1), (W // 2, 0), (0, H // 2), (W - 1, H // 2)]:
        if m[pt[1], pt[0]] == 1: cv2.floodFill(m, ff, pt, 2)
    fg = (m != 2).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)            # drop specks
    fg = np.isin(lab, 1 + np.where(st[1:, cv2.CC_STAT_AREA] > 400)[0]).astype(np.uint8)
    cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    solid = np.zeros_like(fg); cv2.drawContours(solid, cnts, -1, 1, -1)  # white highlights inside stay opaque
    band = cv2.dilate(solid, np.ones((5, 5), np.uint8)) - cv2.erode(solid, np.ones((5, 5), np.uint8))
    inner = cv2.erode(solid, np.ones((9, 9), np.uint8)).astype(bool)
    acc = cv2.GaussianBlur(a * inner[..., None], (0, 0), 6); wgt = cv2.GaussianBlur(inner.astype(np.float32), (0, 0), 6)
    fgc = acc / np.maximum(wgt[..., None], 1e-3)
    est = np.clip((255 - a).max(2) / np.maximum((255 - fgc).max(2), 30), 0, 1)
    alpha = np.where(band > 0, est, solid.astype(np.float32)); alpha = cv2.GaussianBlur(alpha, (0, 0), 0.6)
    alpha[(solid == 0) & (band == 0)] = 0
    col = np.clip(np.where(alpha[..., None] > 0.02, (a - (1 - alpha[..., None]) * 255) / np.maximum(alpha, 1e-3)[..., None], a), 0, 255)
    return np.dstack([col, alpha * 255]).astype(np.uint8)

out = {}
for name, p in P.items():
    rgba = cutout(np.asarray(Image.open(os.path.join(RAW, name + '.png')).convert('RGB')))
    ys, xs = np.where(rgba[..., 3] > 3)
    x0, y0, x1, y1 = max(xs.min() - 6, 0), max(ys.min() - 6, 0), min(xs.max() + 7, rgba.shape[1]), min(ys.max() + 7, rgba.shape[0])
    im = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')
    w, h = round(im.width * S), round(im.height * S)
    im = im.resize((w, h), Image.LANCZOS)
    ox, oy = to_art(x0, y0, p)
    # The generated bodies are 10-45 % taller than the original's (head matched by eye size). Squeeze everything
    # below the neck vertically to the original body height (neck y 748 -> feet y 958), blending over 60 px so the
    # neck has no kink, then move the pose down so the feet stay on the ground line.
    neck_l = to_art(*p['neck'], p)[1] - oy
    kb = min(1.0, BODY_H / (ART_FEET - (neck_l + oy)))
    rows = np.arange(h + 1, dtype=np.float64)
    k = 1 + (kb - 1) * np.clip((rows - (neck_l - 30)) / 60, 0, 1) ** 2 * (3 - 2 * np.clip((rows - (neck_l - 30)) / 60, 0, 1))
    yout = np.concatenate([[0], np.cumsum(k[:-1])])          # output position of each source row
    def ymap(y_local): return float(np.interp(y_local, rows, yout))
    h2 = int(round(yout[-1]))
    src_rows = np.interp(np.arange(h2, dtype=np.float64), yout, rows).astype(np.float32)
    mapy = np.repeat(src_rows[:, None], w, 1); mapx = np.repeat(np.arange(w, dtype=np.float32)[None, :], h2, 0)
    arr = np.asarray(im).astype(np.float32)
    pm = arr.copy(); pm[..., :3] *= pm[..., 3:4] / 255                 # premultiplied, so edges do not bleed
    res = cv2.remap(pm, mapx, mapy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    a_ = np.clip(res[..., 3], 0, 255); res[..., :3] = np.where(a_[..., None] > 0.5, res[..., :3] * 255 / np.maximum(a_[..., None], 1e-3), 0)
    im = Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), 'RGBA'); h = h2
    oy = round(ART_FEET - ymap(ART_FEET - oy), 1)
    oy0 = to_art(x0, y0, p)[1]
    def A(x, y):                                               # raw px -> art px after the squeeze
        ax, ay = to_art(x, y, p); return [ax, round(oy + ymap(ay - oy0), 1)]
    im.save(os.path.join(OUT, 'poses', name + '.webp'), quality=90, method=6)
    print('  body', round(ART_FEET - (neck_l + oy0)), '->', BODY_H, 'k', round(kb, 2))
    # skin colour just above each eye (for the eyelid while blinking)
    src = np.asarray(Image.open(os.path.join(RAW, name + '.png')).convert('RGB')).astype(int)
    eyes = []
    for (ex, ey, rx, ry) in p['eyes']:
        # a ring just outside the eye; the brighter half is the plain skin (shadows, cheeks and brows excluded)
        yy, xx = np.mgrid[ey - 2 * ry: ey + 2 * ry, ex - 2 * rx: ex + 2 * rx]
        e = np.hypot((xx - ex) / rx, (yy - ey) / ry); ring = src[ey - 2 * ry: ey + 2 * ry, ex - 2 * rx: ex + 2 * rx][(e > 1.3) & (e < 1.6)]
        ring = ring[(ring[:, 0] - ring[:, 1] < 25)]                       # not the pink cheeks
        lum = ring.mean(1); sk = ring[lum >= np.percentile(lum, 50)].mean(0)
        c = A(ex, ey); eyes.append(dict(x=c[0], y=c[1], rx=round(rx * S, 1), ry=round(ry * S, 1), skin=[int(v) for v in sk]))
    limbs = []
    for L in p['limbs']:
        d = dict(kind=L['kind'], c=A(*L['c']), r=[round(L['r'][0] * S, 1), round(L['r'][1] * S, 1)],
                 pivot=A(*L['pivot']), amp=L['amp'] * (S if L['kind'] == 'poke' else 1), hz=L['hz'], phase=L.get('phase', 0))
        if 'dir' in L: d['dir'] = L['dir']
        limbs.append(d)
    # eyelids: the skin under each eye, filled in from its surroundings (keeps the face shading), feathered at the rim
    lids = None
    if eyes:
        arr = np.asarray(im).astype(np.float32); rgb = arr[..., :3].copy(); Hh, Ww = rgb.shape[:2]
        yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32)
        hole = np.zeros((Hh, Ww), bool); feather = np.zeros((Hh, Ww), np.float32)
        for e in eyes:
            cx, cy, rx, ry = e['x'] - ox, e['y'] - oy, e['rx'], e['ry']
            d = np.hypot((xx - cx) / (rx + 9), (yy - cy) / (ry + 9)); hole |= d < 1
            d2 = np.hypot((xx - cx) / (rx + 6), (yy - cy) / (ry + 6))
            f = np.clip((1.0 - d2) / (8.0 / (min(rx, ry) + 6)) + 1.0, 0, 1)   # 1 inside, fading out over ~8 px
            feather = np.maximum(feather, np.clip(f, 0, 1) * (d2 < 1 + 8.0 / (min(rx, ry) + 6)))
        fill = cv2.inpaint(rgb.astype(np.uint8), hole.astype(np.uint8), 5, cv2.INPAINT_TELEA).astype(np.float32)
        ys, xs = np.where(hole); y0_, y1_, x0_, x1_ = ys.min() - 2, ys.max() + 3, xs.min() - 2, xs.max() + 3
        sub = fill[y0_:y1_, x0_:x1_].copy(); hm = hole[y0_:y1_, x0_:x1_]
        for it in range(1500):
            avg = (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1)) / 4
            sub[hm] = avg[hm]
        fill[y0_:y1_, x0_:x1_] = sub
        lid = np.dstack([fill, feather * 255]).astype(np.uint8)
        Image.fromarray(lid, 'RGBA').save(os.path.join(OUT, 'poses', name + '_lids.webp'), quality=92, method=6)
        lids = 'poses/%s_lids.webp' % name
    out[name] = dict(img='poses/%s.webp' % name, lids=lids, x=ox, y=oy, w=w, h=h, eyes=eyes, limbs=limbs,
                     neck=A(*p['neck']), headset=A(*p['headset']),
                     heart=A(*p['heart']) if 'heart' in p else None, tilt=p.get('tilt', 0))
    print(name, im.size, 'at', ox, oy, os.path.getsize(os.path.join(OUT, 'poses', name + '.webp')) // 1024, 'KB')
json.dump(out, open(os.path.join(OUT, 'poses.json'), 'w'), indent=1)
