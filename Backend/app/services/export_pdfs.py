from __future__ import annotations

from datetime import datetime
from html import escape
from pathlib import Path
import re
from typing import Any


def build_commercial_pdf(project_data: dict[str, Any], output_path: Path) -> None:
    _ensure_reportlab("Commercial PDF export requires the 'reportlab' package.")

    from reportlab.platypus import Paragraph

    styles = _build_styles()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = _create_doc_template(output_path, title=f"{project_data['project']['name']} - Commercial PDF")

    story = _build_cover_story(
        project_name=project_data["project"]["name"],
        styles=styles,
        title="Commercial Technical Specification",
    )

    sections = project_data.get("sections", [])
    if sections:
        story.extend(_build_sections_story(sections, styles, doc.width, report_type="commercial"))
    else:
        story.append(Paragraph("No commercial sections are currently available for this project.", styles["Normal"]))

    doc.build(story)


def build_full_technical_pdf(project_data: dict[str, Any], output_path: Path) -> None:
    _ensure_reportlab("Full technical PDF export requires the 'reportlab' package.")

    from reportlab.platypus import Paragraph

    styles = _build_styles()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = _create_doc_template(output_path, title=f"{project_data['project']['name']} - Full Technical PDF")

    story = _build_cover_story(
        project_name=project_data["project"]["name"],
        styles=styles,
        title="Full Technical Specification",
    )
    story.extend(_build_toc_story(styles))

    sections = project_data.get("sections", [])
    if sections:
        story.extend(_build_sections_story(sections, styles, doc.width, report_type="full"))
    else:
        story.append(Paragraph("No technical sections are currently available for this project.", styles["Normal"]))

    doc.multiBuild(story)


def _ensure_reportlab(message: str) -> None:
    try:
        import reportlab  # noqa: F401
    except ModuleNotFoundError as exc:
        raise RuntimeError(message) from exc


def _build_styles():
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

    styles = getSampleStyleSheet()

    primary_color = colors.HexColor("#0f172a") # slate-900
    secondary_color = colors.HexColor("#334155") # slate-700
    accent_color = colors.HexColor("#2563eb") # blue-600
    text_color = colors.HexColor("#1e293b") # slate-800

    overrides = {
        "Heading1": ParagraphStyle(name="Heading1", fontSize=24, spaceAfter=6, fontName="Helvetica-Bold", textColor=primary_color, leading=28),
        "Heading2": ParagraphStyle(name="Heading2", fontSize=10.5, spaceAfter=4, fontName="Helvetica-Bold", textColor=secondary_color, leading=14),
        "Normal": ParagraphStyle(name="Normal", fontSize=8.5, spaceAfter=0, spaceBefore=0, fontName="Helvetica", textColor=text_color, leading=11.5),
    }
    for name, style in overrides.items():
        for attr, value in style.__dict__.items():
            if attr != "name" and not attr.startswith("_"):
                setattr(styles[name], attr, value)

    custom_styles = {
        "ProjectName": ParagraphStyle(name="ProjectName", fontSize=16, fontName="Helvetica", textColor=secondary_color, spaceAfter=8, leading=20),
        "TableHeader": ParagraphStyle(
            name="TableHeader",
            parent=styles["Normal"],
            fontSize=8.5,
            alignment=TA_LEFT,
            fontName="Helvetica-Bold",
            textColor=primary_color,
        ),
        "CategoryHeadingStyle": ParagraphStyle(
            name="CategoryHeadingStyle",
            parent=styles["Heading2"],
            fontSize=13,
            fontName="Helvetica-Bold",
            textColor=accent_color,
            spaceBefore=12,
            spaceAfter=6,
            leading=16,
        ),
        "InstanceHeadingStyle": ParagraphStyle(
            name="InstanceHeadingStyle",
            parent=styles["Heading2"],
            fontSize=11,
            fontName="Helvetica-Bold",
            textColor=primary_color,
            spaceBefore=8,
            spaceAfter=4,
            leading=14,
        ),
        "AccessoryHeading": ParagraphStyle(
            name="AccessoryHeading",
            parent=styles["Normal"],
            fontSize=8.5,
            fontName="Helvetica-Bold",
            textColor=primary_color,
            spaceBefore=6,
            spaceAfter=2,
            leading=11,
        ),
        "TocTitleStyle": ParagraphStyle(
            name="TocTitleStyle",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14,
            textColor=primary_color,
            leading=16,
            spaceAfter=12,
        ),
        "TOCLevel0": ParagraphStyle(
            name="TOCLevel0",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            textColor=primary_color,
            leading=14,
            leftIndent=0,
            firstLineIndent=0,
            spaceBefore=3,
            spaceAfter=2,
        ),
        "TOCLevel1": ParagraphStyle(
            name="TOCLevel1",
            parent=styles["Normal"],
            fontSize=9,
            textColor=secondary_color,
            leading=12,
            leftIndent=15,
            firstLineIndent=0,
            spaceAfter=1,
        ),
    }
    for style in custom_styles.values():
        styles.add(style)

    return styles


def _build_cover_story(*, project_name: str, styles, title: str) -> list[Any]:
    from reportlab.lib.units import inch
    from reportlab.platypus import PageBreak, Paragraph, Spacer

    return [
        Spacer(1, 2 * inch),
        Paragraph(escape(title), styles["Heading1"]),
        Spacer(1, 0.1 * inch),
        Paragraph(escape(project_name), styles["ProjectName"]),
        Spacer(1, 0.4 * inch),
        Paragraph(datetime.now().strftime("%Y-%m-%d"), styles["Normal"]),
        PageBreak(),
    ]


def _build_toc_story(styles) -> list[Any]:
    from reportlab.lib.units import inch
    from reportlab.platypus import PageBreak, Paragraph, Spacer
    from reportlab.platypus.tableofcontents import TableOfContents

    toc = TableOfContents()
    toc.levelStyles = [styles["TOCLevel0"], styles["TOCLevel1"]]
    toc.dotsMinLevel = 0

    return [
        Paragraph("CONTENTS", styles["TocTitleStyle"]),
        Spacer(1, 0.2 * inch),
        toc,
        PageBreak(),
    ]


def _build_sections_story(sections: list[dict[str, Any]], styles, available_width: float, *, report_type: str) -> list[Any]:
    from reportlab.lib.units import inch
    from reportlab.platypus import Spacer

    story: list[Any] = []
    for index, section in enumerate(sections):
        section_text = f"{section['number']} {section['name']}"
        story.append(_heading_paragraph(section_text, styles["CategoryHeadingStyle"], level=0, bookmark_prefix="section"))

        for instance in section.get("instances", []):
            story.extend(_build_instance_story(instance, styles, available_width, report_type=report_type))

        if index < len(sections) - 1:
            story.append(Spacer(1, 0.1 * inch))

    return story


def _build_instance_story(instance: dict[str, Any], styles, available_width: float, *, report_type: str) -> list[Any]:
    from reportlab.lib.units import inch
    from reportlab.platypus import KeepTogether, Spacer, Table, TableStyle

    story: list[Any] = []
    heading_text = f"{instance['number']} {instance['display_name']}"
    heading = _heading_paragraph(heading_text, styles["InstanceHeadingStyle"], level=1, bookmark_prefix="instance")

    body_flowables: list[Any] = []
    body_flowables.extend(_instance_body_flowables(instance, styles))

    accessory_flowables = _linked_accessory_flowables(instance.get("linked_accessories", []), styles)
    materials_flowables: list[Any] = []
    if report_type == "full":
        materials = instance.get("materials", [])
        if materials:
            materials_flowables.append(_materials_table(materials, styles, available_width))
            materials_flowables.append(Spacer(1, 0.05 * inch))

    image_flowable = _load_image_flowable(instance.get("image_path"), max_width=available_width * (2 / 3))

    if image_flowable is not None:
        layout_table = Table(
            [[image_flowable, body_flowables or [Spacer(1, 0.01 * inch)]]],
            colWidths=[available_width * (2 / 3), available_width * (1 / 3)],
            hAlign="LEFT",
        )
        layout_table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (0, 0), 0),
                    ("RIGHTPADDING", (0, 0), (0, 0), 6),
                    ("LEFTPADDING", (1, 0), (1, 0), 6),
                    ("RIGHTPADDING", (1, 0), (1, 0), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        story.append(KeepTogether([heading, Spacer(1, 0.02 * inch), layout_table]))
        story.append(Spacer(1, 0.03 * inch))
    else:
        story.append(heading)
        story.append(Spacer(1, 0.02 * inch))
        story.extend(body_flowables)

    story.extend(accessory_flowables)
    story.extend(materials_flowables)
    story.append(Spacer(1, 0.08 * inch))

    return story


def _instance_body_flowables(instance: dict[str, Any], styles) -> list[Any]:
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Spacer

    flowables: list[Any] = []

    description = instance.get("description")
    if description:
        flowables.append(Paragraph(_markup_text(description), styles["Normal"]))
        flowables.append(Spacer(1, 0.02 * inch))

    installation = instance.get("installation")
    if installation:
        flowables.append(Paragraph(_markup_text(installation), styles["Normal"]))
        flowables.append(Spacer(1, 0.02 * inch))

    attributes = instance.get("attributes", [])
    if attributes:
        flowables.append(
            _instance_attribute_flowable(
                attributes,
                styles,
                include_group=any(attribute.get("group") for attribute in attributes),
            )
        )
        flowables.append(Spacer(1, 0.05 * inch))

    return flowables


def _instance_attribute_flowable(attributes: list[dict[str, Any]], styles, *, include_group: bool) -> Any:
    from reportlab.platypus import Paragraph

    if include_group:
        return _attribute_table(attributes, styles, include_group=True)

    if len(attributes) < 3:
        lines = []
        for attribute in attributes:
            name = escape(str(attribute.get("name") or ""))
            value = escape("" if attribute.get("value") is None else str(attribute.get("value")))
            lines.append(f"<b>{name}:</b> {value}")
        return Paragraph("<br />".join(lines), styles["Normal"])

    return _attribute_table(attributes, styles, include_group=False)


def _linked_accessory_flowables(accessories: list[dict[str, Any]], styles) -> list[Any]:
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, Spacer

    flowables: list[Any] = []
    for accessory in accessories:
        heading = accessory["name"]
        if accessory.get("context_label"):
            heading = f"{heading} - {accessory['context_label']}"
        flowables.append(Paragraph(escape(heading), styles["AccessoryHeading"]))

        for attribute in accessory.get("attributes", []):
            name = escape(str(attribute.get("name") or ""))
            value = escape("" if attribute.get("value") is None else str(attribute.get("value")))
            flowables.append(Paragraph(f"<b>{name}:</b> {value}", styles["Normal"]))

        flowables.append(Spacer(1, 0.03 * inch))

    return flowables


def _attribute_table(attributes: list[dict[str, Any]], styles, *, include_group: bool) -> Any:
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    headers = [Paragraph("Attribute", styles["TableHeader"]), Paragraph("Value", styles["TableHeader"])]
    if include_group:
        headers.insert(0, Paragraph("Application", styles["TableHeader"]))

    data = [headers]
    for attribute in attributes:
        value = "" if attribute.get("value") is None else str(attribute.get("value"))
        row = [
            Paragraph(escape(str(attribute.get("name") or "")), styles["Normal"]),
            Paragraph(escape(value), styles["Normal"]),
        ]
        if include_group:
            row.insert(0, Paragraph(escape(str(attribute.get("group") or "General")), styles["Normal"]))
        data.append(row)

    col_widths = [108, 140, 203] if include_group else [160, 291]
    table = Table(data, colWidths=col_widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _materials_table(materials: list[dict[str, Any]], styles, available_width: float) -> Any:
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    data = [[
        Paragraph("Material", styles["TableHeader"]),
        Paragraph("SKU", styles["TableHeader"]),
        Paragraph("Subtype", styles["TableHeader"]),
        Paragraph("Quantity", styles["TableHeader"]),
        Paragraph("Unit", styles["TableHeader"]),
    ]]

    for material in materials:
        rows = material.get("rows", [])
        for index, row in enumerate(rows):
            quantity = "" if row.get("quantity") is None else _format_quantity(row["quantity"])
            data.append(
                [
                    Paragraph(escape(material["material_name"] if index == 0 else ""), styles["Normal"]),
                    Paragraph(escape(material["sku"] if index == 0 else ""), styles["Normal"]),
                    Paragraph(escape(row.get("subtype") or "General"), styles["Normal"]),
                    Paragraph(escape(quantity), styles["Normal"]),
                    Paragraph(escape(material.get("unit") or ""), styles["Normal"]),
                ]
            )

    col_widths = [
        available_width * 0.34,
        available_width * 0.16,
        available_width * 0.22,
        available_width * 0.14,
        available_width * 0.14,
    ]
    table = Table(data, colWidths=col_widths, hAlign="LEFT", repeatRows=1)

    style_commands = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]

    current_row = 1
    for material in materials:
        row_count = len(material.get("rows", []))
        if row_count > 1:
            last_row = current_row + row_count - 1
            style_commands.extend(
                [
                    ("SPAN", (0, current_row), (0, last_row)),
                    ("SPAN", (1, current_row), (1, last_row)),
                    ("SPAN", (4, current_row), (4, last_row)),
                ]
            )
        current_row += row_count

    table.setStyle(TableStyle(style_commands))
    return table


def _format_quantity(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)

    rounded = round(number, 6)
    if float(rounded).is_integer():
        return str(int(rounded))
    return f"{rounded:.6f}".rstrip("0").rstrip(".")


def _markup_text(value: Any) -> str:
    return escape(str(value)).replace("\n", "<br />")


def _load_image_flowable(image_path: Any, *, max_width: float):
    if not image_path:
        return None

    path = Path(str(image_path))
    if not path.is_file():
        return None

    from reportlab.lib.units import inch
    from reportlab.platypus import Image

    image = Image(str(path))
    if image.imageWidth <= 0 or image.imageHeight <= 0:
        return None

    width = min(float(image.imageWidth), max_width)
    height = image.imageHeight * (width / image.imageWidth)
    max_height = 4.5 * inch
    if height > max_height:
        scale = max_height / height
        width *= scale
        height = max_height

    image.drawWidth = width
    image.drawHeight = height
    return image


def _heading_paragraph(text: str, style, *, level: int, bookmark_prefix: str):
    from reportlab.platypus import Paragraph

    paragraph = Paragraph(escape(text), style)
    paragraph._toc_level = level
    paragraph._toc_text = text
    paragraph._bookmark_name = _bookmark_name(bookmark_prefix, text)
    return paragraph


def _bookmark_name(prefix: str, text: str) -> str:
    suffix = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not suffix:
        suffix = "section"
    return f"{prefix}-{suffix}"


def _create_doc_template(output_path: Path, *, title: str):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate

    def draw_page_number(canvas, doc) -> None:
        page_width, _ = doc.pagesize
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawRightString(page_width - doc.rightMargin, 30, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    class ExportDocTemplate(BaseDocTemplate):
        def __init__(self, filename: str, **kwargs: Any) -> None:
            super().__init__(filename, **kwargs)
            frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
            self.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=draw_page_number)])

        def afterFlowable(self, flowable: Any) -> None:
            level = getattr(flowable, "_toc_level", None)
            text = getattr(flowable, "_toc_text", None)
            bookmark_name = getattr(flowable, "_bookmark_name", None)
            if level is None or not text:
                return

            if bookmark_name:
                self.canv.bookmarkPage(bookmark_name)
                try:
                    self.canv.addOutlineEntry(text, bookmark_name, level=level, closed=False)
                except ValueError:
                    pass

            self.notify("TOCEntry", (level, escape(text), self.page, bookmark_name))

    return ExportDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=72,
        leftMargin=72,
        topMargin=60,
        bottomMargin=50,
        title=title,
        allowSplitting=1,
    )
