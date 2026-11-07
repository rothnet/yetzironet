"""One-time import: WordPress export + archive image order -> src/data/creations.json"""
import json, re, html, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
posts = json.load(open(f'{ROOT}/content/wp-posts.json'))
arch = json.load(open(f'{ROOT}/content/archive-images.json'))
norm = lambda u: re.sub(r'-\d+x\d+(\.\w+)$', r'\1', re.sub(r'^.*?/uploads/', '', u))

SLUGS = {1768: 'תמונה-מעוררת-השראה', 1739: 'שעון-ממקשי-מקלדת', 1359: 'רקמה-על-מסכה',
         1164: 'צמיד-מקרמה', 998: 'מובייל-תמונות-בקופסה', 958: 'מאה-יום-מהיום',
         598: 'תמונת-כפתורים-על-קנווס', 357: 'סט-מעטפות-עם-פזל-אישי',
         295: 'תמונה-עם-לב-כפתורים', 88: 'כרטיס-קסם-מדליק'}
# cover photos, in the order the old site listed them
COVERS = [(1164, '2020/11/צמיד-חוטים-28-1.jpg'), (1768, '2021/05/12-1.jpg'), (1739, '2021/05/15.jpg'),
          (1359, '2020/11/מסכה-עם-רקמה-14.jpg'), (998, '2020/08/23.jpg'), (958, '2020/07/7-3.jpg'),
          (598, '2020/07/13-1.jpg'), (357, '2020/07/5.jpg'), (295, '2020/07/תמונת-לב-כפתורים-ראשי.jpeg'),
          (88, '2020/07/תמונה-ראשית.jpg')]
# 958 has no archived page: matched by looking at the photos
MANUAL = {958: ['2020/07/5-3.jpg', '2020/07/6-3.jpg', '2020/07/3-3.jpg', '2020/07/2-3.jpg',
                '2020/07/4-3.jpg', '2020/07/7-3.jpg', '2020/07/8-3.jpg', None]}
FILES = {958: {'label': 'רשימת 100 הפתגמים (PDF)', 'file': '/media/2020/07/100-פיתגמים.pdf'}}

def text(h):
    h = re.sub(r'<br\s*/?>', '\n', h); h = re.sub(r'</p>', '\n', h)
    h = re.sub(r'<[^>]+>', '', h); h = html.unescape(h)
    lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in h.replace('\r', '').split('\n')]
    out, buf = [], []
    for l in lines:
        if l: buf.append(l)
        elif buf: out.append(' '.join(buf)); buf = []
    if buf: out.append(' '.join(buf))
    return out

order = {pid: i for i, (pid, _) in enumerate(COVERS)}
cover = dict(COVERS)
items = []
for p in posts:
    pid = p['id']
    imgs = MANUAL.get(pid) or [norm(x) for x in arch.get(p['slug'], []) if 'uploads' in x and 'לוגו' not in x]
    steps = []
    for i, s in enumerate(p['steps']):
        img = imgs[i] if i < len(imgs) else None
        steps.append({'image': f'/media/{img}' if img else None, 'text': '\n'.join(text(s['text']))})
    c = re.sub(r'<!--.*?-->', '', p['content'])
    mt = re.search(r'<(?:h2|p)[^>]*>(.*?)</(?:h2|p)>', c, re.S)
    materials = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'<li>(.*?)</li>', c, re.S)]
    intro = [l for l in text(p['excerpt']) if l != 'תהנו (:']
    items.append({
        'id': pid, 'slug': SLUGS[pid], 'oldSlug': p['slug'], 'title': p['title'],
        'intro': intro, 'materialsTitle': html.unescape(re.sub(r'<[^>]+>', '', mt.group(1))).strip() if mt else 'מה דרוש לנו?',
        'materials': materials, 'cover': f'/media/{cover[pid]}', 'steps': steps,
        'download': FILES.get(pid), 'order': order[pid]})
items.sort(key=lambda x: x['order'])
os.makedirs(f'{ROOT}/src/data', exist_ok=True)
json.dump(items, open(f'{ROOT}/src/data/creations.json', 'w'), ensure_ascii=False, indent=1)
for it in items: print(it['order'], it['title'], len(it['steps']), sum(1 for s in it['steps'] if s['image']), len(it['materials']))
