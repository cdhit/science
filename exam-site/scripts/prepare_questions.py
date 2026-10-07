from pathlib import Path
import re

import pymupdf


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_PDF = PROJECT_ROOT.parent / "科学.pdf"
QUESTION_DIR = PROJECT_ROOT / "docs" / "questions"
IMAGE_DIR = PROJECT_ROOT / "docs" / "assets" / "source-pages"

# The source contains 40 questions across 41 PDF pages; Q38 spans pages 38-39.
QUESTION_PAGES = {
    **{question: [question] for question in range(1, 38)},
    38: [38, 39],
    39: [40],
    40: [41],
}


def render_source_pages() -> None:
    if not SOURCE_PDF.is_file():
        raise FileNotFoundError(f"Source PDF not found: {SOURCE_PDF}")

    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(SOURCE_PDF)
    try:
        for page_number, page in enumerate(document, start=1):
            scale = 1800 / page.rect.width
            image = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            image_path = IMAGE_DIR / f"page-{page_number:02}.jpg"
            image.save(image_path, jpg_quality=92)
    finally:
        document.close()


def create_question_pages() -> tuple[int, int]:
    QUESTION_DIR.mkdir(parents=True, exist_ok=True)
    created = 0
    preserved = 0

    for question_number, page_numbers in QUESTION_PAGES.items():
        markdown_path = QUESTION_DIR / f"q{question_number:02}.md"
        if markdown_path.exists():
            original = markdown_path.read_text(encoding="utf-8")
            normalized = re.sub(
                r'<div class="question-source">\s*(!\[原题，PDF 第 \d+ 页\]\(\.\./assets/source-pages/page-\d+\.jpg\))\s*</div>',
                r"\1",
                original,
            )
            normalized = re.sub(
                r'(?<!\[)(!\[原题，PDF 第 \d+ 页\]\((\.\./assets/source-pages/page-\d+\.jpg)\))',
                r"[\1](\2)",
                normalized,
            )
            if normalized != original:
                markdown_path.write_text(normalized, encoding="utf-8")
            preserved += 1
            continue

        lines = [
            f"# 第 {question_number} 题",
            "",
            "## 原题",
            "",
        ]
        for page_number in page_numbers:
            lines.extend(
                [
                    f"[![原题，PDF 第 {page_number} 页](../assets/source-pages/page-{page_number:02}.jpg)](../assets/source-pages/page-{page_number:02}.jpg)",
                    "",
                ]
            )
        lines.extend(["## 分析", "", "（在此填写本题分析。）", ""])
        markdown_path.write_text("\n".join(lines), encoding="utf-8")
        created += 1

    return created, preserved


def main() -> None:
    render_source_pages()
    created, preserved = create_question_pages()
    source_page_count = sum(len(page_numbers) for page_numbers in QUESTION_PAGES.values())
    print(
        f"Rendered {source_page_count} source pages for {len(QUESTION_PAGES)} questions "
        f"from {SOURCE_PDF.name}."
    )
    print(f"Created {created} Markdown pages; preserved {preserved} existing pages.")


if __name__ == "__main__":
    main()