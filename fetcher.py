#!/usr/bin/env python3
"""
fetcher.py - Sincronizzatore per Book Radar Desklet
Supporta feed multiformato:
- Novità da Giunti al Punto (Shopify API)
- Classifica Bestseller di Amazon Italia (Web scraping)
- Modalità Mista (Bestseller Amazon + Novità Giunti, senza duplicati)

Scarica metadati puliti e cover art in cache locale (~/.cache/book-radar/).
"""

import sys
import os
import json
import re
import urllib.request
import urllib.parse
import urllib.error
import argparse
from pathlib import Path
from bs4 import BeautifulSoup


CACHE_DIR = Path.home() / ".cache" / "book-radar"
COVERS_DIR = CACHE_DIR / "covers"
DEFAULT_FEED_FILE = CACHE_DIR / "feed.json"
DEFAULT_COLLECTION = "novita-da-non-perdere"
DEFAULT_LIMIT = 30
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Linux"',
}


def clean_html(raw_html: str) -> str:
    """Rimuove tag HTML e spazi superflui dalla sinossi."""
    if not raw_html:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw_html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_title(title: str) -> str:
    """Normalizza un titolo per il confronto anti-duplicati."""
    t = title.lower()
    t = re.sub(r"\bediz\.?\s+italiana\b", "", t)
    t = re.sub(r"\bediz\.?\s+a\s+colori\b", "", t)
    t = re.sub(r"\blimited\s+edition\b", "", t)
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())


def parse_giunti_authors(tags: list, handle: str) -> str:
    """Estrae l'autore o gli autori formattati correttamente (Nome Cognome) da tag Giunti."""
    authors = []
    for t in tags:
        if t.startswith("AUTORE::"):
            surname = t.replace("AUTORE::", "").lower()
            found = False
            for cand in tags:
                cand_lower = cand.lower()
                if cand_lower.startswith(surname + "_"):
                    name_part = cand_lower[len(surname) + 1:].replace("_", " ").title()
                    full = f"{name_part} {surname.title()}"
                    if full not in authors:
                        authors.append(full)
                    found = True
                    break
            if not found:
                authors.append(surname.title())

    if authors:
        return ", ".join(authors)

    isbn_m = re.search(r"(\d{13})", handle)
    if isbn_m:
        before_isbn = handle[:isbn_m.start()].rstrip("-")
        parts = before_isbn.split("-")
        if len(parts) >= 2:
            return f"{parts[-1].title()} {parts[-2].title()}"

    return "Autore Sconosciuto"


def parse_giunti_product(product: dict, base_url: str) -> dict:
    """Converte un prodotto Shopify di Giunti al Punto in una scheda libro pulita."""
    title = product.get("title", "").strip()
    handle = product.get("handle", "")
    tags = product.get("tags", [])
    raw_desc = product.get("body_html", "")
    description = clean_html(raw_desc)

    isbn_m = re.search(r"(\d{13})", handle)
    isbn = isbn_m.group(1) if isbn_m else str(product.get("id", ""))
    author = parse_giunti_authors(tags, handle)

    variants = product.get("variants", [])
    price_str = ""
    if variants:
        raw_price = variants[0].get("price", "")
        if raw_price:
            try:
                price_str = f"€ {float(raw_price):.2f}".replace(".", ",")
            except ValueError:
                price_str = f"€ {raw_price}"

    images = product.get("images", [])
    image_url = images[0].get("src", "") if images else ""

    giunti_url = f"{base_url.rstrip('/')}/products/{handle}"
    if isbn and len(isbn) == 13:
        amazon_url = f"https://www.amazon.it/s?k={isbn}"
    else:
        query_safe = urllib.parse.quote(f"{title} {author}")
        amazon_url = f"https://www.amazon.it/s?k={query_safe}"

    cover_filename = f"giunti_{isbn}.jpg" if isbn else f"giunti_{product.get('id')}.jpg"
    cover_path = str(COVERS_DIR / cover_filename)

    return {
        "id": f"giunti_{product.get('id')}",
        "title": title,
        "author": author,
        "isbn": isbn,
        "price": price_str,
        "description": description,
        "image_url": image_url,
        "cover_path": cover_path,
        "giunti_url": giunti_url,
        "amazon_url": amazon_url,
        "source": "giunti",
        "badge": "✨ Novità",
    }


def download_cover(image_url: str, target_path: str, force: bool = False) -> bool:
    """Scarica la copertina in cache se non già presente."""
    if not image_url or not target_path:
        return False

    dest = Path(target_path)
    if dest.exists() and dest.stat().st_size > 1024 and not force:
        return True

    tmp_file = dest.with_suffix(".tmp")
    try:
        req = urllib.request.Request(image_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                with open(tmp_file, "wb") as f:
                    f.write(resp.read())
                tmp_file.replace(dest)
                return True
    except Exception as e:
        if tmp_file.exists():
            tmp_file.unlink()
        print(f"[!] Errore download copertina {image_url}: {e}", file=sys.stderr)
        return False
    return False


def fetch_giunti(collection: str = DEFAULT_COLLECTION, limit: int = DEFAULT_LIMIT, force_covers: bool = False) -> list:
    """Scarica le novità librarie da Giunti al Punto."""
    url = f"https://giuntialpunto.it/collections/{collection}/products.json?limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                print(f"[!] Errore HTTP {response.status} da Giunti: {url}", file=sys.stderr)
                return []
            raw_data = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"[!] Errore connessione Giunti: {e}", file=sys.stderr)
        return []

    raw_products = raw_data.get("products", [])
    books = []

    for item in raw_products:
        book = parse_giunti_product(item, base_url="https://giuntialpunto.it")
        if book["image_url"]:
            download_cover(book["image_url"], book["cover_path"], force=force_covers)
        books.append(book)

    return books


def fetch_amazon_bestsellers(limit: int = 20, force_covers: bool = False) -> list:
    """Scarica la classifica Bestseller Libri da Amazon Italia."""
    url = "https://www.amazon.it/gp/bestsellers/books"
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)

    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            if response.status != 200:
                print(f"[!] Errore HTTP {response.status} da Amazon: {url}", file=sys.stderr)
                return []
            html = response.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"[!] Errore connessione Amazon Bestseller: {e}", file=sys.stderr)
        return []

    soup = BeautifulSoup(html, "html.parser")
    items = soup.select("#gridItemRoot")
    books = []

    for idx, item in enumerate(items[:limit], 1):
        # Rank / Posizione
        rank_elem = item.select_one(".zg-bdg-text, span[class*='zg-badge'], .zg-bdg-body")
        rank = rank_elem.get_text(strip=True) if rank_elem else f"#{idx}"

        # Immagine
        img = item.select_one("img")
        img_src = img.get("src", "") if img else ""

        # Titolo
        title = ""
        title_elem = item.select_one('div[class*="line-clamp-1"], div[class*="line-clamp-2"], .p13n-sc-truncate')
        if title_elem:
            title = title_elem.get_text(strip=True)
        elif img:
            title = img.get("alt", "").strip()

        if not title:
            continue

        # Autore (cerca tra le righe descrittive evitando righe con stelle o formati)
        author = "Autore Sconosciuto"
        for r in item.select(".a-row.a-size-small"):
            txt = r.get_text(strip=True)
            if not txt:
                continue
            txt_lower = txt.lower()
            if "stelle" in txt_lower or "formati" in txt_lower:
                continue
            if any(f in txt_lower for f in ["copertina", "flessibile", "rigida", "kindle", "audiolibro"]):
                continue
            author = txt
            break

        # Prezzo
        price = ""
        price_elem = item.select_one('span[class*="price"], .p13n-sc-price')
        if price_elem:
            price = price_elem.get_text(strip=True)

        # Link e ASIN
        link = item.select_one('a.a-link-normal[href*="/dp/"]')
        href = link.get("href", "") if link else ""
        asin_m = re.search(r'/dp/([A-Z0-9]{10})', href)
        asin = asin_m.group(1) if asin_m else f"bestseller_{idx}"

        amazon_url = f"https://www.amazon.it/dp/{asin}" if asin_m else (
            f"https://www.amazon.it{href}" if href.startswith("/") else "https://www.amazon.it/gp/bestsellers/books"
        )
        giunti_url = f"https://giuntialpunto.it/search?q={urllib.parse.quote(title)}"

        # Copertina in alta risoluzione
        high_res_img = img_src
        if "_AC_UL300_SR300,200_" in img_src:
            high_res_img = img_src.replace("_AC_UL300_SR300,200_", "_AC_UL600_SR600,400_")

        cover_filename = f"amz_{asin}.jpg"
        cover_path = str(COVERS_DIR / cover_filename)

        book = {
            "id": f"amazon_{asin}",
            "title": title,
            "author": author,
            "isbn": asin if len(asin) == 10 and asin.isdigit() else "",
            "price": price,
            "description": f"Classifica Bestseller Amazon: posizione {rank}.",
            "image_url": high_res_img,
            "cover_path": cover_path,
            "giunti_url": giunti_url,
            "amazon_url": amazon_url,
            "source": "amazon",
            "badge": f"🏆 {rank} Amazon",
        }

        # Scarica copertina (prova prima high-res, se fallisce ripiega su img_src)
        if high_res_img:
            ok = download_cover(high_res_img, cover_path, force=force_covers)
            if not ok and img_src != high_res_img:
                download_cover(img_src, cover_path, force=force_covers)

        books.append(book)

    return books


def fetch_feed(source: str = "mixed", collection: str = DEFAULT_COLLECTION, limit: int = DEFAULT_LIMIT, force_covers: bool = False) -> list:
    """Scarica il catalogo in base alla sorgente richiesta ('mixed', 'amazon', 'giunti')."""
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    books = []

    if source == "giunti":
        books = fetch_giunti(collection=collection, limit=limit, force_covers=force_covers)
    elif source == "amazon":
        books = fetch_amazon_bestsellers(limit=limit, force_covers=force_covers)
    else:
        # Sorgente 'mixed': combina Top 15 Bestseller Amazon + Novità Giunti
        amz_books = fetch_amazon_bestsellers(limit=15, force_covers=force_covers)
        giunti_books = fetch_giunti(collection=collection, limit=20, force_covers=force_covers)

        # Interleave con deduplicazione su titolo normalizzato
        seen_titles = set()
        mixed_list = []

        max_len = max(len(amz_books), len(giunti_books))
        for i in range(max_len):
            if i < len(amz_books):
                b = amz_books[i]
                norm = normalize_title(b["title"])
                if norm not in seen_titles:
                    seen_titles.add(norm)
                    mixed_list.append(b)

            if i < len(giunti_books):
                b = giunti_books[i]
                norm = normalize_title(b["title"])
                if norm not in seen_titles:
                    seen_titles.add(norm)
                    mixed_list.append(b)

        books = mixed_list[:limit]

    # Scrittura atomica del feed.json
    tmp_feed = DEFAULT_FEED_FILE.with_suffix(".tmp")
    with open(tmp_feed, "w", encoding="utf-8") as f:
        json.dump(books, f, indent=2, ensure_ascii=False)
    tmp_feed.replace(DEFAULT_FEED_FILE)

    return books


def main():
    parser = argparse.ArgumentParser(description="Fetch and cache books for Book Radar")
    parser.add_argument("--source", choices=["mixed", "amazon", "giunti"], default="mixed", help="Sorgente feed (mixed, amazon, giunti)")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION, help="Nome collezione Giunti")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Numero max di libri")
    parser.add_argument("--force-covers", action="store_true", help="Riscarica le copertine esistenti")
    parser.add_argument("--quiet", action="store_true", help="Non stampare output")

    args = parser.parse_args()
    books = fetch_feed(source=args.source, collection=args.collection, limit=args.limit, force_covers=args.force_covers)

    if not args.quiet:
        print(f"✅ Sincronizzati {len(books)} libri [{args.source}] in: {DEFAULT_FEED_FILE}")
        for idx, b in enumerate(books, 1):
            source_badge = b.get("badge", b.get("source", ""))
            print(f"  {idx}. [{source_badge}] {b['title']} - {b['author']} ({b['price']})")


if __name__ == "__main__":
    main()
