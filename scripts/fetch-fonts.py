"""Download the Google Fonts stylesheet used by index.html and serve it from
the app instead, so the interface keeps its font offline.

Usage: python3 fetch-fonts.py <www folder>
Exits non-zero on any problem; index.html is only changed after every font
file has downloaded, so a failure leaves the page using the online link.
"""
import html
import os
import re
import sys
import urllib.request

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def main(www):
    index_path = os.path.join(www, "index.html")
    page = open(index_path, encoding="utf-8").read()
    link = re.search(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com/[^"]+)">', page)
    if not link:
        print("No Google Fonts link found; nothing to do.")
        return
    css = get(html.unescape(link.group(1))).decode("utf-8")

    font_dir = os.path.join(www, "fonts")
    os.makedirs(font_dir, exist_ok=True)
    urls = sorted(set(re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css)))
    if not urls:
        raise SystemExit("Stylesheet had no font files.")
    for i, url in enumerate(urls):
        ext = os.path.splitext(url)[1] or ".woff2"
        name = f"archivo-{i}{ext}"
        with open(os.path.join(font_dir, name), "wb") as f:
            f.write(get(url))
        css = css.replace(url, name)
    with open(os.path.join(font_dir, "fonts.css"), "w", encoding="utf-8") as f:
        f.write(css)

    page = page.replace(link.group(0), '<link rel="stylesheet" href="fonts/fonts.css">')
    # These only speed up the website's first visit; the app never uses them.
    page = re.sub(r'\s*<link rel="preconnect" href="https://[^"]+"( crossorigin)?>', "", page)
    open(index_path, "w", encoding="utf-8").write(page)
    print(f"Saved {len(urls)} font files.")


if __name__ == "__main__":
    main(sys.argv[1])
