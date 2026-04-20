"""Board pack PDF generation (ReportLab)."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import HRFlowable, Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# ─── BRAND COLORS ────────────────────
DARK_BLUE = colors.HexColor("#1E3A5F")
MID_BLUE = colors.HexColor("#2E6DA4")
ORANGE = colors.HexColor("#F97316")
LIGHT_ORANGE = colors.HexColor("#FFF7ED")
GREEN = colors.HexColor("#166534")
RED = colors.HexColor("#DC2626")
AMBER = colors.HexColor("#D97706")
GREY_BG = colors.HexColor("#F1F5F9")
DARK_TEXT = colors.HexColor("#1E293B")
MID_GREY = colors.HexColor("#64748B")
WHITE = colors.white

PAGE_W, PAGE_H = A4
MARGIN = 2 * cm

# Optional client logo: place `logo.png` or `logo.jpg` in the `backend/` directory.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _append_cover_logo_block(story: list) -> None:
    """Enterprise cover: real logo if present, else grey placeholder box (~adds PDF weight vs bare text)."""
    logo_png = _BACKEND_ROOT / "logo.png"
    logo_jpg = _BACKEND_ROOT / "logo.jpg"
    logo_path = logo_png if logo_png.is_file() else (logo_jpg if logo_jpg.is_file() else None)
    if logo_path is not None:
        try:
            story.append(Image(str(logo_path), width=4 * cm, height=2 * cm))
        except Exception:
            logo_path = None
    if logo_path is None:
        logo_box = Table(
            [[Paragraph("COMPANY LOGO", ParagraphStyle("LogoPh", fontSize=8, textColor=colors.HexColor("#94A3B8"), alignment=TA_CENTER))]],
            colWidths=[4 * cm],
            rowHeights=[2 * cm],
        )
        logo_box.setStyle(
            TableStyle(
                [
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#E2E8F0")),
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                ]
            )
        )
        story.append(logo_box)
    story.append(Spacer(1, 0.5 * cm))


class BoardPackGenerator:
    def __init__(self, watermark: str = "DRAFT") -> None:
        self.watermark = watermark
        self.company_name = "Company"
        self.period_label = ""
        self.styles = getSampleStyleSheet()
        self._setup_styles()

    def _setup_styles(self) -> None:
        self.style_h1 = ParagraphStyle(
            "H1",
            fontSize=20,
            fontName="Helvetica-Bold",
            textColor=DARK_BLUE,
            spaceAfter=6,
            spaceBefore=12,
        )
        self.style_h2 = ParagraphStyle(
            "H2",
            fontSize=14,
            fontName="Helvetica-Bold",
            textColor=DARK_BLUE,
            spaceAfter=4,
            spaceBefore=10,
        )
        self.style_h3 = ParagraphStyle(
            "H3",
            fontSize=11,
            fontName="Helvetica-Bold",
            textColor=ORANGE,
            spaceAfter=3,
            spaceBefore=8,
        )
        self.style_body = ParagraphStyle(
            "Body",
            fontSize=9,
            fontName="Helvetica",
            textColor=DARK_TEXT,
            leading=14,
            spaceAfter=6,
        )
        self.style_caption = ParagraphStyle(
            "Caption", fontSize=8, fontName="Helvetica", textColor=MID_GREY, leading=12
        )

    def _fmt(self, amount: Any, currency: str = "₹") -> str:
        if amount is None:
            return "-"
        try:
            val = float(amount)
            sym = currency if currency else ""
            if abs(val) >= 10000000:
                return f"{sym}{val / 10000000:.2f}Cr"
            if abs(val) >= 100000:
                return f"{sym}{val / 100000:.2f}L"
            if abs(val) >= 1000:
                return f"{sym}{val / 1000:.1f}K"
            return f"{sym}{val:,.0f}"
        except (TypeError, ValueError):
            return str(amount)

    def _watermark_on_page(self, canvas_obj: pdfcanvas.Canvas, doc: Any) -> None:
        canvas_obj.saveState()

        canvas_obj.setFont("Helvetica-Bold", 60)
        canvas_obj.setFillColor(colors.Color(0.9, 0.9, 0.9, alpha=0.3))
        canvas_obj.translate(PAGE_W / 2, PAGE_H / 2)
        canvas_obj.rotate(45)
        canvas_obj.drawCentredString(0, 0, self.watermark)
        canvas_obj.rotate(-45)
        canvas_obj.translate(-PAGE_W / 2, -PAGE_H / 2)

        canvas_obj.setFillColor(DARK_BLUE)
        canvas_obj.rect(0, PAGE_H - 1.2 * cm, PAGE_W, 1.2 * cm, fill=1, stroke=0)

        canvas_obj.setFont("Helvetica-Bold", 9)
        canvas_obj.setFillColor(WHITE)
        canvas_obj.drawString(MARGIN, PAGE_H - 0.8 * cm, f"CONFIDENTIAL — {self.company_name}")
        canvas_obj.drawRightString(PAGE_W - MARGIN, PAGE_H - 0.8 * cm, f"Board Pack — {self.period_label}")

        canvas_obj.setFillColor(MID_GREY)
        canvas_obj.setFont("Helvetica", 7)
        canvas_obj.drawString(MARGIN, 0.6 * cm, "Generated by FinReportAI • Confidential")
        canvas_obj.drawRightString(PAGE_W - MARGIN, 0.6 * cm, f"Page {doc.page}")

        canvas_obj.setFillColor(ORANGE)
        canvas_obj.rect(0, PAGE_H - 1.4 * cm, PAGE_W, 0.2 * cm, fill=1, stroke=0)

        canvas_obj.restoreState()

    def _build_cover(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Spacer(1, 3 * cm))

        story.append(
            Paragraph(
                str(data.get("company_name", "Company")).upper(),
                ParagraphStyle(
                    "Cover1",
                    fontSize=28,
                    fontName="Helvetica-Bold",
                    textColor=DARK_BLUE,
                    alignment=TA_CENTER,
                ),
            )
        )
        story.append(Spacer(1, 0.5 * cm))
        _append_cover_logo_block(story)
        story.append(HRFlowable(width="60%", thickness=3, color=ORANGE, hAlign="CENTER"))
        story.append(Spacer(1, 0.5 * cm))
        story.append(
            Paragraph(
                "BOARD FINANCIAL REPORT",
                ParagraphStyle(
                    "Cover2",
                    fontSize=18,
                    fontName="Helvetica",
                    textColor=MID_GREY,
                    alignment=TA_CENTER,
                ),
            )
        )
        story.append(Spacer(1, 0.3 * cm))
        story.append(
            Paragraph(
                f"For the period ended {data.get('period_end', '')}",
                ParagraphStyle(
                    "Cover3",
                    fontSize=13,
                    fontName="Helvetica",
                    textColor=DARK_TEXT,
                    alignment=TA_CENTER,
                ),
            )
        )
        story.append(Spacer(1, 2 * cm))

        cur = data.get("currency") or "₹"
        kpis = [
            ["Revenue", self._fmt(data.get("revenue"), cur), "Total Income"],
            ["Gross Margin", f"{float(data.get('gross_margin_pct') or 0):.1f}%", "Profitability"],
            ["Cash", self._fmt(data.get("cash"), cur), "Liquidity"],
        ]
        kpi_row = [
            [
                Paragraph(k[0], self.style_caption),
                Paragraph(
                    k[1],
                    ParagraphStyle(
                        "KV2",
                        fontSize=20,
                        fontName="Helvetica-Bold",
                        textColor=ORANGE,
                        alignment=TA_CENTER,
                    ),
                ),
                Paragraph(k[2], self.style_caption),
            ]
            for k in kpis
        ]
        cover_table = Table([kpi_row], colWidths=[(PAGE_W - 2 * MARGIN) / 3] * 3)
        cover_table.setStyle(
            TableStyle(
                [
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (0, 0), LIGHT_ORANGE),
                    ("BACKGROUND", (1, 0), (1, 0), LIGHT_ORANGE),
                    ("BACKGROUND", (2, 0), (2, 0), LIGHT_ORANGE),
                    ("ROUNDEDCORNERS", [4]),
                    ("TOPPADDING", (0, 0), (-1, -1), 16),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.5, ORANGE),
                ]
            )
        )
        story.append(cover_table)
        story.append(Spacer(1, 2 * cm))
        story.append(
            Paragraph(
                f"● {self.watermark} — BOARD CONFIDENTIAL",
                ParagraphStyle(
                    "Conf",
                    fontSize=9,
                    fontName="Helvetica-Bold",
                    textColor=RED if self.watermark == "DRAFT" else GREEN,
                    alignment=TA_CENTER,
                ),
            )
        )
        story.append(Spacer(1, 0.5 * cm))
        story.append(
            Paragraph(
                f"Prepared: {datetime.now().strftime('%d %B %Y')}  • Currency: {cur}  • Generated by FinReportAI",
                ParagraphStyle("Footer2", fontSize=8, textColor=MID_GREY, alignment=TA_CENTER),
            )
        )
        story.append(PageBreak())
        return story

    def _build_executive_summary(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Paragraph("01 — EXECUTIVE SUMMARY", self.style_h1))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        commentary = data.get("executive_summary", "")
        if commentary:
            story.append(Paragraph(commentary, self.style_body))
        story.append(Spacer(1, 0.3 * cm))

        cur = data.get("currency") or "₹"
        kpi_items = [
            ("Revenue", data.get("revenue"), data.get("revenue_vs_prior_pct")),
            ("Gross Profit", data.get("gross_profit"), data.get("gross_margin_pct")),
            ("EBIT", data.get("ebit"), data.get("ebit_margin_pct")),
            ("Net Profit", data.get("profit_after_tax"), data.get("net_margin_pct")),
            ("Total Assets", data.get("total_assets"), None),
            ("Cash", data.get("cash"), None),
        ]
        rows_data: list[list] = []
        row: list = []
        for label, value, pct in kpi_items:
            arrow = ""
            color = DARK_BLUE
            if pct is not None:
                arrow = "▲" if float(pct) >= 0 else "▼"
                color = GREEN if float(pct) >= 0 else RED
            cell: list = [
                Paragraph(label, self.style_caption),
                Paragraph(
                    self._fmt(value, cur),
                    ParagraphStyle(
                        "KV3",
                        fontSize=14,
                        fontName="Helvetica-Bold",
                        textColor=DARK_BLUE,
                        alignment=TA_CENTER,
                    ),
                ),
            ]
            if pct is not None:
                cell.append(
                    Paragraph(
                        f"{arrow} {abs(float(pct)):.1f}%",
                        ParagraphStyle(
                            "Pct", fontSize=8, fontName="Helvetica-Bold", textColor=color, alignment=TA_CENTER
                        ),
                    )
                )
            row.append(cell)
            if len(row) == 3:
                rows_data.append(row)
                row = []
        col_w = (PAGE_W - 2 * MARGIN) / 3
        for row_data in rows_data:
            t = Table([row_data], colWidths=[col_w] * 3)
            t.setStyle(
                TableStyle(
                    [
                        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("BACKGROUND", (0, 0), (-1, -1), GREY_BG),
                        ("TOPPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ]
                )
            )
            story.append(t)
            story.append(Spacer(1, 0.2 * cm))
        story.append(PageBreak())
        return story

    def _build_pl(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Paragraph("02 — PROFIT & LOSS STATEMENT", self.style_h1))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        pl_data = data.get("profit_loss_lines", [])
        if pl_data:
            headers = ["", "Current Period", "Prior Period", "Variance", "Var %"]
            col_widths = [6 * cm, 3 * cm, 3 * cm, 2.5 * cm, 2 * cm]
            table_data: list[list] = [headers]
            for line in pl_data:
                is_total = line.get("is_subtotal") or line.get("is_total")
                is_section = line.get("is_section_header")
                if is_section:
                    row = [
                        Paragraph(
                            str(line.get("ifrs_line_item", "")).upper(),
                            ParagraphStyle("Sec", fontSize=8, fontName="Helvetica-Bold", textColor=WHITE),
                        ),
                        "",
                        "",
                        "",
                        "",
                    ]
                elif is_total:
                    amt = float(line.get("amount") or 0)
                    prior = float(line.get("prior_amount") or 0)
                    var = amt - prior
                    var_pct = (var / abs(prior) * 100) if prior else 0.0
                    row = [
                        Paragraph(
                            f"  {line.get('ifrs_line_item', '')}",
                            ParagraphStyle("Tot", fontSize=9, fontName="Helvetica-Bold", textColor=DARK_BLUE),
                        ),
                        Paragraph(
                            self._fmt(amt, ""),
                            ParagraphStyle(
                                "TotN", fontSize=9, fontName="Helvetica-Bold", textColor=DARK_BLUE, alignment=TA_RIGHT
                            ),
                        ),
                        Paragraph(
                            self._fmt(prior, ""),
                            ParagraphStyle(
                                "TotP", fontSize=9, fontName="Helvetica-Bold", textColor=MID_GREY, alignment=TA_RIGHT
                            ),
                        ),
                        Paragraph(
                            self._fmt(var, ""),
                            ParagraphStyle(
                                "TotV",
                                fontSize=9,
                                fontName="Helvetica-Bold",
                                textColor=GREEN if var >= 0 else RED,
                                alignment=TA_RIGHT,
                            ),
                        ),
                        Paragraph(
                            f"{var_pct:+.1f}%",
                            ParagraphStyle(
                                "TotVP",
                                fontSize=9,
                                fontName="Helvetica-Bold",
                                textColor=GREEN if var >= 0 else RED,
                                alignment=TA_RIGHT,
                            ),
                        ),
                    ]
                else:
                    amt = float(line.get("amount") or 0)
                    prior = float(line.get("prior_amount") or 0)
                    var = amt - prior
                    var_pct = (var / abs(prior) * 100) if prior else 0.0
                    row = [
                        Paragraph(
                            f"    {line.get('ifrs_line_item', '')}",
                            ParagraphStyle("Li", fontSize=8, fontName="Helvetica", textColor=DARK_TEXT),
                        ),
                        Paragraph(self._fmt(amt, ""), ParagraphStyle("LiN", fontSize=8, alignment=TA_RIGHT)),
                        Paragraph(
                            self._fmt(prior, ""),
                            ParagraphStyle("LiP", fontSize=8, textColor=MID_GREY, alignment=TA_RIGHT),
                        ),
                        Paragraph(
                            self._fmt(var, ""),
                            ParagraphStyle(
                                "LiV", fontSize=8, textColor=GREEN if var >= 0 else RED, alignment=TA_RIGHT
                            ),
                        ),
                        Paragraph(
                            f"{var_pct:+.1f}%",
                            ParagraphStyle(
                                "LiVP", fontSize=8, textColor=GREEN if var >= 0 else RED, alignment=TA_RIGHT
                            ),
                        ),
                    ]
                table_data.append(row)

            style_cmds: list[tuple] = [
                ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 9),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
            ]
            for i, line in enumerate(pl_data, start=1):
                if line.get("is_section_header"):
                    style_cmds.append(("BACKGROUND", (0, i), (-1, i), MID_BLUE))
                elif line.get("is_subtotal") or line.get("is_total"):
                    style_cmds.append(("BACKGROUND", (0, i), (-1, i), GREY_BG))
                    style_cmds.append(("LINEABOVE", (0, i), (-1, i), 0.8, DARK_BLUE))
                else:
                    bg = WHITE if i % 2 == 0 else colors.HexColor("#F8FAFC")
                    style_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))

            pl_table = Table(table_data, colWidths=col_widths)
            pl_table.setStyle(TableStyle(style_cmds))
            story.append(pl_table)

        commentary = data.get("pl_commentary", "")
        if commentary:
            story.append(Spacer(1, 0.3 * cm))
            story.append(Paragraph("Management Commentary", self.style_h3))
            story.append(Paragraph(commentary, self.style_body))
        story.append(PageBreak())
        return story

    def _build_balance_sheet(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Paragraph("03 — BALANCE SHEET SNAPSHOT", self.style_h1))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        ratios = [
            ("Current Ratio", f"{float(data.get('current_ratio') or 0):.2f}x", "> 1.5x preferred"),
            ("Debt / Equity", f"{float(data.get('debt_to_equity') or 0):.2f}x", "< 1.0x preferred"),
            ("Gearing", f"{float(data.get('gearing_pct') or 0):.1f}%", "< 50% preferred"),
            ("Return on Assets", f"{float(data.get('roa_pct') or 0):.1f}%", "Higher is better"),
        ]
        ratio_row = []
        for label, value, benchmark in ratios:
            ratio_row.append(
                [
                    Paragraph(label, self.style_caption),
                    Paragraph(
                        value,
                        ParagraphStyle(
                            "RV", fontSize=16, fontName="Helvetica-Bold", textColor=DARK_BLUE, alignment=TA_CENTER
                        ),
                    ),
                    Paragraph(
                        benchmark,
                        ParagraphStyle("RB", fontSize=7, textColor=MID_GREY, alignment=TA_CENTER),
                    ),
                ]
            )
        col_w = (PAGE_W - 2 * MARGIN) / 4
        r_table = Table([ratio_row], colWidths=[col_w] * 4)
        r_table.setStyle(
            TableStyle(
                [
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (-1, -1), LIGHT_ORANGE),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                    ("GRID", (0, 0), (-1, -1), 0.5, ORANGE),
                ]
            )
        )
        story.append(r_table)
        story.append(Spacer(1, 0.4 * cm))

        bs_summary = [
            ["", "Current Period", "Prior Period"],
            ["ASSETS", "", ""],
            [
                "Total Current Assets",
                self._fmt(data.get("total_current_assets"), ""),
                self._fmt(data.get("prior_current_assets"), ""),
            ],
            [
                "Total Non-Current Assets",
                self._fmt(data.get("total_non_current_assets"), ""),
                self._fmt(data.get("prior_non_current_assets"), ""),
            ],
            ["TOTAL ASSETS", self._fmt(data.get("total_assets"), ""), self._fmt(data.get("prior_total_assets"), "")],
            ["LIABILITIES & EQUITY", "", ""],
            [
                "Total Current Liabilities",
                self._fmt(data.get("total_current_liabilities"), ""),
                "-",
            ],
            [
                "Total Non-Current Liabilities",
                self._fmt(data.get("total_non_current_liabilities"), ""),
                "-",
            ],
            ["Total Equity", self._fmt(data.get("total_equity"), ""), "-"],
            ["TOTAL LIABILITIES + EQUITY", self._fmt(data.get("total_assets"), ""), "-"],
        ]
        bs_table = Table(bs_summary, colWidths=[8 * cm, 4 * cm, 4 * cm])
        bs_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
                    ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("BACKGROUND", (0, 1), (-1, 1), MID_BLUE),
                    ("TEXTCOLOR", (0, 1), (-1, 1), WHITE),
                    ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                    ("BACKGROUND", (0, 4), (-1, 4), GREY_BG),
                    ("FONTNAME", (0, 4), (-1, 4), "Helvetica-Bold"),
                    ("BACKGROUND", (0, 5), (-1, 5), MID_BLUE),
                    ("TEXTCOLOR", (0, 5), (-1, 5), WHITE),
                    ("FONTNAME", (0, 5), (-1, 5), "Helvetica-Bold"),
                    ("BACKGROUND", (0, 9), (-1, 9), GREY_BG),
                    ("FONTNAME", (0, 9), (-1, 9), "Helvetica-Bold"),
                    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
                    ("LINEBELOW", (0, 4), (-1, 4), 1.5, DARK_BLUE),
                    ("LINEBELOW", (0, 9), (-1, 9), 1.5, DARK_BLUE),
                ]
            )
        )
        story.append(bs_table)
        commentary = data.get("balance_sheet_commentary", "")
        if commentary:
            story.append(Spacer(1, 0.3 * cm))
            story.append(Paragraph("Balance Sheet Commentary", self.style_h3))
            story.append(Paragraph(commentary, self.style_body))
        story.append(PageBreak())
        return story

    def _build_variance(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Paragraph("04 — MATERIAL VARIANCE ANALYSIS", self.style_h1))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        variances = data.get("material_variances", [])
        if variances:
            var_data = [["Account", "Current", "Prior", "Change", "Var %", "Flag"]]
            for v in variances[:15]:
                pct = float(v.get("variance_pct") or 0)
                if abs(pct) > 25:
                    flag, flag_color = "HIGH", RED
                elif abs(pct) > 10:
                    flag, flag_color = "WATCH", AMBER
                else:
                    flag, flag_color = "OK", GREEN
                var_data.append(
                    [
                        Paragraph(str(v.get("account_name", "")), ParagraphStyle("VA", fontSize=8)),
                        Paragraph(
                            self._fmt(v.get("current", 0), ""),
                            ParagraphStyle("VN", fontSize=8, alignment=TA_RIGHT),
                        ),
                        Paragraph(
                            self._fmt(v.get("prior", 0), ""),
                            ParagraphStyle("VP", fontSize=8, textColor=MID_GREY, alignment=TA_RIGHT),
                        ),
                        Paragraph(
                            self._fmt(v.get("variance", 0), ""),
                            ParagraphStyle(
                                "VV",
                                fontSize=8,
                                textColor=GREEN if float(v.get("variance") or 0) >= 0 else RED,
                                alignment=TA_RIGHT,
                            ),
                        ),
                        Paragraph(
                            f"{pct:+.1f}%",
                            ParagraphStyle(
                                "VVP", fontSize=8, fontName="Helvetica-Bold", textColor=flag_color, alignment=TA_RIGHT
                            ),
                        ),
                        Paragraph(
                            flag,
                            ParagraphStyle(
                                "VF", fontSize=7, fontName="Helvetica-Bold", textColor=flag_color, alignment=TA_CENTER
                            ),
                        ),
                    ]
                )
            var_table = Table(var_data, colWidths=[5.5 * cm, 2.5 * cm, 2.5 * cm, 2.5 * cm, 2 * cm, 1.5 * cm])
            var_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
                        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("FONTSIZE", (0, 0), (-1, 0), 9),
                        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAFC")]),
                        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
                    ]
                )
            )
            story.append(var_table)
        else:
            story.append(
                Paragraph(
                    "No material variances are shown for this period. Either IFRS statements have not been "
                    "generated for this trial balance, or no line items met the filters (absolute amount "
                    "≥ 100 and estimated variance vs prior ≥ 8%). Regenerate statements after upload, or "
                    "add comparative period data (Week 4) for real prior-year variances.",
                    self.style_body,
                )
            )
        story.append(PageBreak())
        return story

    def _build_risk(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Paragraph("05 — RISK & COMPLIANCE DASHBOARD", self.style_h1))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        score = int(data.get("compliance_score") or 0)
        score_color = GREEN if score >= 80 else (AMBER if score >= 60 else RED)
        score_table = Table(
            [
                [
                    Paragraph("IFRS Compliance Score", self.style_caption),
                    Paragraph(
                        f"{score}%",
                        ParagraphStyle(
                            "CS", fontSize=28, fontName="Helvetica-Bold", textColor=score_color, alignment=TA_CENTER
                        ),
                    ),
                    Paragraph(
                        "AUDIT READY" if score >= 80 else "REVIEW NEEDED",
                        ParagraphStyle(
                            "CR", fontSize=10, fontName="Helvetica-Bold", textColor=score_color, alignment=TA_CENTER
                        ),
                    ),
                ]
            ],
            colWidths=[(PAGE_W - 2 * MARGIN) / 3] * 3,
        )
        score_table.setStyle(
            TableStyle(
                [
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (-1, -1), GREY_BG),
                    ("TOPPADDING", (0, 0), (-1, -1), 16),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                ]
            )
        )
        story.append(score_table)
        story.append(Spacer(1, 0.4 * cm))
        risks = data.get("risk_flags", [])
        if risks:
            story.append(Paragraph("Risk Flags", self.style_h3))
            risk_data = [["Severity", "Risk", "Metric", "Recommendation"]]
            for r in risks[:10]:
                sev = (r.get("severity") or "amber").lower()
                sev_color = RED if sev == "red" else (AMBER if sev == "amber" else GREEN)
                sev_label = "HIGH" if sev == "red" else ("MED" if sev == "amber" else "LOW")
                risk_data.append(
                    [
                        Paragraph(
                            sev_label,
                            ParagraphStyle(
                                "RS",
                                fontSize=8,
                                fontName="Helvetica-Bold",
                                textColor=sev_color,
                                alignment=TA_CENTER,
                            ),
                        ),
                        Paragraph(str(r.get("title", ""))[:40], ParagraphStyle("RT", fontSize=8)),
                        Paragraph(str(r.get("metric", ""))[:30], ParagraphStyle("RM", fontSize=7, textColor=MID_GREY)),
                        Paragraph(str(r.get("recommendation", ""))[:60], ParagraphStyle("RR", fontSize=7)),
                    ]
                )
            risk_table = Table(risk_data, colWidths=[2 * cm, 5 * cm, 4 * cm, 5.5 * cm])
            risk_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), DARK_BLUE),
                        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("FONTSIZE", (0, 0), (-1, 0), 8),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F8FAFC")]),
                        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
                    ]
                )
            )
            story.append(risk_table)
        story.append(PageBreak())
        return story

    def _build_recommendations(self, data: dict[str, Any]) -> list:
        story: list = []
        story.append(Paragraph("06 — STRATEGIC RECOMMENDATIONS", self.style_h1))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        recs = data.get(
            "recommendations",
            [
                {
                    "priority": "1",
                    "title": "Revenue Growth",
                    "action": data.get("rec_1", "Focus on high-margin service revenue."),
                    "timeline": "30 days",
                    "impact": "High",
                },
                {
                    "priority": "2",
                    "title": "Cost Optimisation",
                    "action": data.get("rec_2", "Review operating expense structure."),
                    "timeline": "60 days",
                    "impact": "Medium",
                },
                {
                    "priority": "3",
                    "title": "Working Capital",
                    "action": data.get("rec_3", "Improve debtor collection cycle."),
                    "timeline": "90 days",
                    "impact": "Medium",
                },
            ],
        )
        for rec in recs:
            left = Paragraph(
                str(rec.get("priority", "1")),
                ParagraphStyle(
                    "RP", fontSize=20, fontName="Helvetica-Bold", textColor=WHITE, alignment=TA_CENTER
                ),
            )
            # List of flowables stacks vertically in one cell (KeepTogether here breaks row height).
            right: list = [
                Paragraph(str(rec.get("title", "")), self.style_h3),
                Paragraph(str(rec.get("action", "")), self.style_body),
                Paragraph(
                    f"Timeline: {rec.get('timeline', '')}  • Impact: {rec.get('impact', '')}",
                    self.style_caption,
                ),
            ]
            box_table = Table([[left, right]], colWidths=[1.5 * cm, PAGE_W - 2 * MARGIN - 1.5 * cm])
            box_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (0, 0), ORANGE),
                        ("BACKGROUND", (1, 0), (1, 0), LIGHT_ORANGE),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("TOPPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("GRID", (0, 0), (-1, -1), 0.5, ORANGE),
                    ]
                )
            )
            story.append(box_table)
            story.append(Spacer(1, 0.3 * cm))
        story.append(Spacer(1, 0.5 * cm))
        story.append(HRFlowable(width="100%", thickness=1, color=ORANGE, spaceAfter=8))
        story.append(
            Paragraph(
                f"This report was generated by FinReportAI on {datetime.now().strftime('%d %B %Y')}. "
                f"All figures in {data.get('currency', '₹')}. Status: {self.watermark}.",
                self.style_caption,
            )
        )
        return story

    def generate(self, data: dict[str, Any], output_path: str) -> str:
        """Generate complete board pack PDF to ``output_path``."""
        self.company_name = str(data.get("company_name", "Company"))
        self.period_label = str(data.get("period_end", ""))

        out_abs = os.path.abspath(output_path)
        parent = os.path.dirname(out_abs)
        if parent:
            os.makedirs(parent, exist_ok=True)

        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            rightMargin=MARGIN,
            leftMargin=MARGIN,
            topMargin=MARGIN + 1 * cm,
            bottomMargin=MARGIN,
        )
        story: list = []
        story += self._build_cover(data)
        story += self._build_executive_summary(data)
        story += self._build_pl(data)
        story += self._build_balance_sheet(data)
        story += self._build_variance(data)
        story += self._build_risk(data)
        story += self._build_recommendations(data)
        doc.build(story, onFirstPage=self._watermark_on_page, onLaterPages=self._watermark_on_page)
        return output_path


def count_pdf_pages(path: str) -> int:
    try:
        from pypdf import PdfReader

        return len(PdfReader(path).pages)
    except Exception:
        return 7
