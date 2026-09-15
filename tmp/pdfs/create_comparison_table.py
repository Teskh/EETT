from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle


OUTPUT = Path("output/pdf/comparacion_bosquemar_escritores.pdf")
FONT_DIR = Path("C:/Windows/Fonts")

pdfmetrics.registerFont(TTFont("Arial", str(FONT_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_DIR / "arialbd.ttf")))


def make_paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def build_pdf() -> None:
    page_width, page_height = landscape(A4)
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=(page_width, page_height),
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )

    styles = getSampleStyleSheet()
    header_style = ParagraphStyle(
        "TableHeader",
        parent=styles["Normal"],
        fontName="Arial-Bold",
        fontSize=10,
        leading=12,
        textColor=colors.white,
        alignment=1,
    )
    label_style = ParagraphStyle(
        "TableLabel",
        parent=styles["Normal"],
        fontName="Arial-Bold",
        fontSize=9.5,
        leading=11.5,
        textColor=colors.HexColor("#263238"),
    )
    value_style = ParagraphStyle(
        "TableValue",
        parent=styles["Normal"],
        fontName="Arial",
        fontSize=9.5,
        leading=11.5,
        textColor=colors.HexColor("#263238"),
        alignment=1,
    )

    rows = [
        ["Medida", "Los Escritores", "Bosquemar Plus - Valdivia"],
        ["Estado", "En ejecución", "Plantilla"],
        ["Instancias", "80", "35"],
        ["Componentes únicos de catálogo", "79", "20"],
        ["Líneas de cubicación", "601", "181"],
        ["Cantidades de cubicación completadas", "586, 97,5%", "0, 0%"],
        ["Cantidades en blanco", "15", "181"],
        ["Categorías cubiertas", "25", "6"],
        ["Variantes o subtipos", "2", "0"],
        ["Materiales únicos, SKU", "435", "82"],
        ["Relaciones de aplicación", "65", "28"],
        ["Vínculos con producción", "113", "0"],
        ["Valores de atributos", "209, todos completos", "99, con 98 completos"],
    ]

    table_data = []
    for row_index, row in enumerate(rows):
        style = header_style if row_index == 0 else None
        if style is None:
            table_data.append(
                [
                    make_paragraph(row[0], label_style),
                    make_paragraph(row[1], value_style),
                    make_paragraph(row[2], value_style),
                ]
            )
        else:
            table_data.append([make_paragraph(value, style) for value in row])

    table = Table(
        table_data,
        colWidths=[105 * mm, 70 * mm, 83 * mm],
        repeatRows=1,
        hAlign="CENTER",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#37474F")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#B0BEC5")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7F8")]),
            ]
        )
    )

    document.build([table])


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    build_pdf()
