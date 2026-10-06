# Trace the Sora Systems logo (blue mark) from the reference image into a normalized polygon.
import sys, json, numpy as np
from PIL import Image
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
I = Image.open(sys.argv[1]).convert('RGBA'); im = np.asarray(I).astype(float)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mask = (im[..., 3] > 128) & ((b - r) > 60)
ys, xs = np.nonzero(mask)
print('bbox', xs.min(), xs.max(), ys.min(), ys.max(), im.shape)
m = mask.astype(float)
from scipy.ndimage import gaussian_filter
m = gaussian_filter(m, 1.2)
cs = plt.contour(m, levels=[0.5])
paths = cs.allsegs[0]
paths.sort(key=len, reverse=True)
p = paths[0]
print('contours', [len(q) for q in paths[:4]])
# normalize: center, height = 1
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
h = ys.max() - ys.min()
p = (p - [cx, cy]) / h
# resample uniformly by arc length to N points
d = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
N = 720
s = np.linspace(0, d[-1], N, endpoint=False)
q = np.c_[np.interp(s, d, p[:, 0]), np.interp(s, d, p[:, 1])]
json.dump({'aspect': float((xs.max() - xs.min()) / h), 'pts': np.round(q, 4).tolist()}, open(sys.argv[2], 'w'))
print('ok', len(q))
