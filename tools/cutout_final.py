"""抠图 v6（最终版）：蓝色/深色/白色骨架 → 连通域 → 只留角色主体（含相邻的白袜子、鞋）
→ 补内部洞 → 丢掉「太薄」的漏网背景线 → 羽化 → 裁边 → 存 RGBA PNG。"""
import sys
import numpy as np
from PIL import Image, ImageFilter

SRC, DST = sys.argv[1], sys.argv[2]
WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 240


def max4(m):
    out = m.copy()
    out[1:, :] = np.maximum(out[1:, :], m[:-1, :]); out[:-1, :] = np.maximum(out[:-1, :], m[1:, :])
    out[:, 1:] = np.maximum(out[:, 1:], m[:, :-1]); out[:, :-1] = np.maximum(out[:, :-1], m[:, 1:])
    return out


def label(mask):
    ys, xs = np.nonzero(mask)
    lab = np.zeros(mask.shape, np.int32)
    lab[ys, xs] = np.arange(1, len(ys) + 1, dtype=np.int32)
    for _ in range(4000):
        nxt = np.where(mask, np.maximum(lab, max4(np.where(mask, lab, 0))), 0)
        if (nxt == lab).all():
            break
        lab = nxt
    return lab


def dil(m, k):
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(k))) > 127


def ero(m, k):
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(k))) > 127


def spread(mask, cur):
    out = cur.copy()
    out[1:, :] |= cur[:-1, :]; out[:-1, :] |= cur[1:, :]
    out[:, 1:] |= cur[:, :-1]; out[:, :-1] |= cur[:, 1:]
    return out & mask


def fill_holes(mask):
    h, w = mask.shape
    outside = np.zeros((h, w), bool)
    outside[0, :] = outside[h - 1, :] = outside[:, 0] = outside[:, w - 1] = True
    outside &= ~mask
    for _ in range(4000):
        nxt = spread(~mask, outside)
        if nxt.sum() == outside.sum():
            break
        outside = nxt
    return mask | (~mask & ~outside)


img = Image.open(SRC).convert('RGB')
rgb = np.asarray(img)
h, w, _ = rgb.shape
hsv = np.asarray(img.convert('HSV')).astype(np.float32)
H, S, V = hsv[:, :, 0] * 360 / 255, hsv[:, :, 1] / 255, hsv[:, :, 2] / 255

skeleton = ((H > 180) & (H < 295) & (S > 0.20) & (V > 0.08)) | (V < 0.22) | ((V > 0.84) & (S < 0.13))
lab = label(skeleton)
ids, counts = np.unique(lab[lab > 0], return_counts=True)
main_id = ids[np.argmax(counts)]
main = lab == main_id
yy, xx = np.nonzero(main)
x0, x1, y_bottom = xx.min(), xx.max(), yy.max()
print('main %d px  x[%d,%d] bottom y=%d' % (main.sum(), x0, x1, y_bottom))

near = dil(main, 7)
keep = [main_id]
for cid, cnt in zip(ids, counts):
    if cnt < 200 or cid == main_id:
        continue
    m = lab == cid
    ys, xs = np.nonzero(m)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    if bw > 4 * bh:                                  # 细长横条 = 背景线
        continue
    if not (x0 - 0.04 * w <= xs.mean() <= x1 + 0.04 * w):
        continue
    if (m & near).any() or (ys.min() > y_bottom and cnt > 300 and bw < 0.55 * w):
        keep.append(cid)
char = np.isin(lab, keep)
print('char %d px from %d comps' % (char.sum(), len(keep)))

filled = fill_holes(char)

# 只保留「有厚度」的连通块：细背景线在腐蚀后消失，角色还在
thick = ero(filled, 5)
lab3 = label(filled)
ids3, counts3 = np.unique(lab3[lab3 > 0], return_counts=True)
solid = np.zeros((h, w), bool)
for cid, cnt in zip(ids3, counts3):
    m = lab3 == cid
    if (m & thick).any():
        solid |= m
print('after thickness filter %.3f (was %.3f)' % (solid.mean(), filled.mean()))
solid = fill_holes(solid)
solid = dil(ero(solid, 7), 7)
solid[:, :16] = False
solid[:, -14:] = False
lab4 = label(solid)
ids4, counts4 = np.unique(lab4[lab4 > 0], return_counts=True)
solid = np.isin(lab4, [int(c) for c, n in zip(ids4, counts4) if n >= 400])
solid = fill_holes(solid)


alpha = Image.fromarray(np.where(solid, 255, 0).astype(np.uint8), 'L')
alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
alpha = alpha.point(lambda v: 0 if v < 40 else (255 if v > 225 else v))

out = img.convert('RGBA')
out.putalpha(alpha)

# 中间那段腿被背景抠掉了，袜子+鞋看着悬空：把脚整体上移贴住裙摆（连像素一起搬）
rows = np.nonzero(solid.any(axis=1))[0]
gaps = [r for r in range(int(rows.min()), int(rows.max())) if not solid[r].any()]
if gaps:
    feet_top = max(gaps) + 1
    hem_bottom = min(gaps) - 1
    shift = feet_top - hem_bottom - 3
    if 0 < shift < 120:
        feet = out.crop((0, feet_top, w, int(rows.max()) + 1))
        blank = Image.new('RGBA', (w, int(rows.max()) + 1 - feet_top), (0, 0, 0, 0))
        out.paste(blank, (0, feet_top))
        out.alpha_composite(feet, (0, hem_bottom + 3))
        print('feet lifted by %d px' % shift)
        alpha = out.split()[3]
        bb = alpha.point(lambda v: 255 if v > 60 else 0).getbbox()
        assert bb is not None
bb = alpha.point(lambda v: 255 if v > 60 else 0).getbbox()
if bb:
    p = 6
    l, t, r, b = bb
    out = out.crop((max(0, l - p), max(0, t - p), min(w, r + p), min(h, b + p)))
sc = WIDTH / out.width
out = out.resize((WIDTH, max(1, round(out.height * sc))), Image.LANCZOS)
out.save(DST, 'PNG', optimize=True)
chk = Image.new('RGBA', out.size, (255, 0, 200, 255))
chk.alpha_composite(out)
chk.convert('RGB').save(DST.replace('.png', '-check.png'))
print('saved %s %s' % (DST, out.size))
