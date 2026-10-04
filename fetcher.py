#!/usr/bin/env python3
"""
fetcher.py - Sincronizzatore per Book Radar Desklet
Scarica il feed delle novità da Giunti al Punto (Shopify API),
estrae metadati puliti (titolo, autore, ISBN, prezzo, link Amazon e Giunti)
e scarica in cache locale le copertine dei libri.
"""

import sys
import os
import json
import re
import urllib.request
import urllib.error
import argparse
from pathlib import Path


CACHE_DIR = Path.home() / ".cache" / "book-radar"
COVERS_DIR = CACHE_DIR / "covers"
DEFAULT_FEED_FILE = CACHE_DIR / "feed.json"
DEFAULT_COLLECTION = "novita-da-non-perdere"
DEFAULT_LIMIT = 30
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def clean_html(raw_html: str) -> str:
    """Rimuove tag HTML e spazi superflui dalla sinossi."""
    if not raw_html:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw_html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_authors(tags: list, handle: str) -> str:
    """Estrae l'autore o gli autori formattati correttamente (Nome Cognome)."""
    authors = []
    
    # Cerca tag specifici del tipo 'cognome_nome' o 'AUTORE::COGNOME'
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

    # Fallback su handle (es. ...-autore-cognome-isbn)
    isbn_m = re.search(r"(\d{13})", handle)
    if isbn_m:
        before_isbn = handle[:isbn_m.start()].rstrip("-")
        parts = before_isbn.split("-")
        if len(parts) >= 2:
            return f"{parts[-1].title()} {parts[-2].title()}"

    return "Autore Sconosciuto"


def parse_product(product: dict, base_url: str) -> dict:
    """Converte un prodotto Shopify di Giunti al Punto in una scheda libro pulita."""
    title = product.get("title", "").strip()
    handle = product.get("handle", "")
    tags = product.get("tags", [])
    raw_desc = product.get("body_html", "")
    description = clean_html(raw_desc)
    
    # Estrai ISBN (13 cifre nell'handle o nell'id)
    isbn_m = re.search(r"(\d{13})", handle)
    isbn = isbn_m.group(1) if isbn_m else str(product.get("id", ""))

    author = parse_authors(tags, handle)

    # Prezzo
    variants = product.get("variants", [])
    price_str = ""
    if variants:
        raw_price = variants[0].get("price", "")
        if raw_price:
            try:
                price_str = f"€ {float(raw_price):.2f}".replace(".", ",")
            except ValueError:
                price_str = f"€ {raw_price}"

    # Immagine di copertina
    images = product.get("images", [])
    image_url = images[0].get("src", "") if images else ""

    # Link web
    giunti_url = f"{base_url.rstrip('/')}/products/{handle}"
    # Ricerca diretta su Amazon tramite ISBN (o titolo + autore se ISBN assente)
    if isbn and len(isbn) == 13:
        amazon_url = f"https://www.amazon.it/s?k={isbn}"
    else:
        query_safe = urllib.parse.quote(f"{title} {author}")
        amazon_url = f"https://www.amazon.it/s?k={query_safe}"

    # Percorso locale della copertina
    cover_filename = f"{isbn}.jpg" if isbn else f"{product.get('id')}.jpg"
    cover_path = str(COVERS_DIR / cover_filename)

    return {
        "id": str(product.get("id")),
        "title": title,
        "author": author,
        "isbn": isbn,
        "price": price_str,
        "description": description,
        "image_url": image_url,
        "cover_path": cover_path,
        "giunti_url": giunti_url,
        "amazon_url": amazon_url,
        "handle": handle,
    }


def download_cover(image_url: str, target_path: str, force: bool = False):
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
        # Silently log error, desklet will handle fallback
        print(f"[!] Errore download copertina {image_url}: {e}", file=sys.stderr)
        return False
    return False


def fetch_feed(collection: str = DEFAULT_COLLECTION, limit: int = DEFAULT_LIMIT, force_covers: bool = False) -> list:
    """Scarica l'elenco dei libri da Giunti al Punto e aggiorna la cache."""
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    
    url = f"https://giuntialpunto.it/collections/{collection}/products.json?limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status != 200:
                print(f"[!] Errore HTTP {response.status} da {url}", file=sys.stderr)
                return []
            raw_data = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"[!] Errore connessione feed: {e}", file=sys.stderr)
        return []

    raw_products = raw_data.get("products", [])
    books = []

    for item in raw_products:
        book = parse_product(item, base_url="https://giuntialpunto.it")
        if book["image_url"]:
            download_cover(book["image_url"], book["cover_path"], force=force_covers)
        books.append(book)

    # Scrittura atomica del feed.json
    tmp_feed = DEFAULT_FEED_FILE.with_suffix(".tmp")
    with open(tmp_feed, "w", encoding="utf-8") as f:
        json.dump(books, f, indent=2, ensure_ascii=False)
    tmp_feed.replace(DEFAULT_FEED_FILE)

    return books


def main():
    parser = argparse.ArgumentParser(description="Fetch and cache books from Giunti al Punto")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION, help="Nome collezione Giunti")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Numero max di libri")
    parser.add_argument("--force-covers", action="store_true", help="Riscarica le copertine esistenti")
    parser.add_argument("--quiet", action="store_true", help="Non stampare output")

    args = parser.parse_args()
    books = fetch_feed(collection=args.collection, limit=args.limit, force_covers=args.force_covers)

    if not args.quiet:
        print(f"✅ Sincronizzati {len(books)} libri in: {DEFAULT_FEED_FILE}")
        for idx, b in enumerate(books, 1):
            print(f"  {idx}. {b['title']} - {b['author']} ({b['price']})")


if __name__ == "__main__":
    main()
