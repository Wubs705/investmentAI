"""Analysis router — property analysis, comps, and PDF report generation."""

import io
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc

from backend.auth import get_current_user
from backend.models.database import AnalysisRecord, PropertyRecord, async_session, get_supabase

router = APIRouter(prefix="/api", tags=["analysis"])

_PROPERTY_ID_RE = r"^[A-Za-z0-9_\-]+$"


# ── DB helpers (Supabase-first, SQLite fallback) ──────────────────────────────

async def _fetch_property_data(property_id: str, user_id: str | None = None) -> dict:
    """Return the raw property JSON dict."""
    supabase = await get_supabase()
    if supabase:
        response = await (
            supabase.table("properties")
            .select("data")
            .eq("id", property_id)
            .limit(1)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail=f"Property {property_id} not found.")
        raw = response.data[0]["data"]
        if isinstance(raw, dict):
            return raw
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Malformed property data for {property_id}: {exc}",
            )
    else:
        async with async_session() as session:
            result = await session.execute(
                select(PropertyRecord).where(PropertyRecord.id == property_id)
            )
            record = result.scalar_one_or_none()
            if not record:
                raise HTTPException(status_code=404, detail=f"Property {property_id} not found.")
            try:
                return json.loads(record.data)
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Malformed property data for {property_id}: {exc}",
                )


async def _fetch_latest_analysis_data(property_id: str, user_id: str | None = None) -> dict | None:
    """Return the latest analysis JSON dict, or None if not found."""
    supabase = await get_supabase()
    if supabase:
        query = (
            supabase.table("analyses")
            .select("data")
            .eq("property_id", property_id)
            .order("analyzed_at", desc=True)
            .limit(1)
        )
        if user_id:
            query = query.eq("user_id", user_id)
        response = await query.execute()
        if not response.data:
            return None
        raw = response.data[0]["data"]
        if isinstance(raw, dict):
            return raw
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Malformed analysis data for property {property_id}: {exc}",
            )
    else:
        async with async_session() as session:
            result = await session.execute(
                select(AnalysisRecord)
                .where(AnalysisRecord.property_id == property_id)
                .order_by(desc(AnalysisRecord.analyzed_at))
                .limit(1)
            )
            record = result.scalar_one_or_none()
            if not record:
                return None
            try:
                return json.loads(record.data)
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Malformed analysis data for property {property_id}: {exc}",
                )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/property/{property_id}/analysis")
async def get_property_analysis(
    property_id: str = Path(min_length=1, max_length=64, pattern=_PROPERTY_ID_RE),
    user_id: str | None = Depends(get_current_user),
):
    """Return the most recent stored analysis for a property."""
    data = await _fetch_latest_analysis_data(property_id, user_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail=f"No analysis found for property {property_id}. Run a search first.",
        )
    return data


@router.get("/property/{property_id}/comps")
async def get_property_comps(
    property_id: str = Path(min_length=1, max_length=64, pattern=_PROPERTY_ID_RE),
    user_id: str | None = Depends(get_current_user),
):
    """Return comparable properties analysis for a property."""
    from backend.models.schemas import PropertyListing
    from backend.services.comparables import comparables_service
    from backend.services.geocoding import geocoding_service
    from backend.services.market_data import market_data_service

    prop_data = await _fetch_property_data(property_id, user_id)
    try:
        listing = PropertyListing(**prop_data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid property record: {e}")

    location = await geocoding_service.normalize_location(f"{listing.city}, {listing.state}")
    if not location:
        raise HTTPException(status_code=422, detail="Could not geocode property location.")

    market = await market_data_service.get_market_snapshot(location)
    comps = await comparables_service.find_comps(listing, market)
    return comps


@router.get("/property/{property_id}/report")
async def get_property_report(
    property_id: str = Path(min_length=1, max_length=64, pattern=_PROPERTY_ID_RE),
    user_id: str | None = Depends(get_current_user),
):
    """Generate and return a PDF analysis report for the property."""
    from backend.models.schemas import PropertyListing
    from backend.services.geocoding import geocoding_service
    from backend.services.market_data import market_data_service

    prop_data = await _fetch_property_data(property_id, user_id)
    try:
        listing = PropertyListing(**prop_data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid property record: {e}")

    analysis_data = await _fetch_latest_analysis_data(property_id, user_id) or {}

    location = await geocoding_service.normalize_location(f"{listing.city}, {listing.state}")
    market = await market_data_service.get_market_snapshot(location) if location else None

    pdf_buffer = _generate_pdf(listing, analysis_data, market)

    safe_id = re.sub(r"[^A-Za-z0-9_\-]", "_", property_id)[:64]
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="report_{safe_id}.pdf"'},
    )


def _generate_pdf(listing, analysis_data: dict, market) -> io.BytesIO:
    """Generate a ReportLab PDF for the property analysis."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
    styles = getSampleStyleSheet()

    heading1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=18, spaceAfter=6)
    heading2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, spaceAfter=4, textColor=colors.HexColor("#1d4ed8"))
    normal = styles["Normal"]
    small = ParagraphStyle("Small", parent=normal, fontSize=9, textColor=colors.grey)

    story = []

    story.append(Paragraph("Real Estate Investment Analysis Report", heading1))
    story.append(Paragraph(f"{listing.address}, {listing.city}, {listing.state} {listing.zip_code}", normal))
    story.append(Spacer(1, 0.1 * inch))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1d4ed8")))
    story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Property Overview", heading2))
    overview_data = [
        ["List Price", f"${listing.list_price:,}"],
        ["Bedrooms / Bathrooms", f"{listing.bedrooms} bd / {listing.bathrooms} ba"],
        ["Square Footage", f"{listing.sqft:,} sqft"],
        ["Price per sqft", f"${listing.price_per_sqft:,.2f}"],
        ["Year Built", str(listing.year_built or "N/A")],
        ["Property Type", listing.property_type],
        ["Days on Market", str(listing.days_on_market or "N/A")],
        ["HOA", f"${listing.hoa_monthly:,}/mo" if listing.hoa_monthly else "None"],
        ["Annual Tax", f"${listing.tax_annual:,}" if listing.tax_annual else "Estimated"],
    ]
    t = Table(overview_data, colWidths=[2.5 * inch, 3.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.2 * inch))

    uni = analysis_data.get("universal", {})
    if uni:
        story.append(Paragraph("Financial Analysis", heading2))
        fin_data = [
            ["Down Payment (20%)", f"${uni.get('down_payment_amount', 0):,.0f}"],
            ["Loan Amount", f"${uni.get('loan_amount', 0):,.0f}"],
            ["Monthly Mortgage (P&I)", f"${uni.get('monthly_mortgage_payment', 0):,.2f}"],
            ["Monthly Tax", f"${uni.get('property_tax_monthly', 0):,.2f}"],
            ["Monthly Insurance", f"${uni.get('insurance_estimate_monthly', 0):,.2f}"],
            ["Total Monthly Cost (PITI+HOA)", f"${uni.get('total_monthly_cost', 0):,.2f}"],
            ["Estimated Market Value", f"${uni.get('estimated_market_value', 0):,}"],
            ["Price vs Market", f"{uni.get('price_vs_market_pct', 0):+.1f}%"],
        ]
        ft = Table(fin_data, colWidths=[2.5 * inch, 3.5 * inch])
        ft.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(ft)
        story.append(Spacer(1, 0.2 * inch))

    goal = analysis_data.get("investment_goal", "")

    if goal == "rental" and analysis_data.get("rental"):
        r = analysis_data["rental"]
        story.append(Paragraph("Rental Analysis", heading2))
        rent_data = [
            ["Estimated Monthly Rent", f"${r.get('estimated_monthly_rent', 0):,}"],
            ["Monthly Cash Flow", f"${r.get('monthly_cash_flow', 0):,.2f}"],
            ["Cap Rate", f"{r.get('cap_rate_pct', 0):.2f}%"],
            ["Cash-on-Cash Return", f"{r.get('cash_on_cash_return_pct', 0):.2f}%"],
            ["Gross Rent Multiplier", f"{r.get('gross_rent_multiplier', 0):.1f}x"],
            ["DSCR", f"{r.get('dscr', 0):.2f}"],
            ["Break-Even Occupancy", f"{r.get('break_even_occupancy_pct', 0):.1f}%"],
            ["Rent-to-Price Ratio", f"{r.get('rent_to_price_ratio', 0):.3f}%"],
        ]
        rt = Table(rent_data, colWidths=[2.5 * inch, 3.5 * inch])
        rt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(rt)
        story.append(Spacer(1, 0.2 * inch))

    elif goal == "long_term" and analysis_data.get("long_term"):
        lt = analysis_data["long_term"]
        story.append(Paragraph("Long-Term Hold Analysis", heading2))
        lt_data = [
            ["5-Year Projected Value", f"${lt.get('projected_value_5yr', 0):,}"],
            ["10-Year Projected Value", f"${lt.get('projected_value_10yr', 0):,}"],
            ["5-Year Appreciation", f"{lt.get('appreciation_5yr_pct', 0):.1f}%"],
            ["10-Year Appreciation", f"{lt.get('appreciation_10yr_pct', 0):.1f}%"],
            ["Projected Equity (5yr)", f"${lt.get('projected_equity_5yr', 0):,}"],
            ["Projected Equity (10yr)", f"${lt.get('projected_equity_10yr', 0):,}"],
            ["Total ROI (10yr)", f"{lt.get('total_roi_10yr_pct', 0):.1f}%"],
            ["Annualized Return", f"{lt.get('annualized_return_pct', 0):.1f}%"],
        ]
        ltt = Table(lt_data, colWidths=[2.5 * inch, 3.5 * inch])
        ltt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(ltt)
        story.append(Spacer(1, 0.2 * inch))

    elif goal == "fix_and_flip" and analysis_data.get("flip"):
        f = analysis_data["flip"]
        story.append(Paragraph("Fix & Flip Analysis", heading2))
        flip_data = [
            ["ARV (After-Repair Value)", f"${f.get('arv', 0):,}"],
            ["Estimated Rehab Cost", f"${f.get('estimated_rehab_cost', 0):,}"],
            ["Rehab Scope", f.get('rehab_scope', 'N/A')],
            ["Maximum Allowable Offer", f"${f.get('mao', 0):,}"],
            ["Potential Profit", f"${f.get('potential_profit', 0):,}"],
            ["ROI on Flip", f"{f.get('roi_pct', 0):.1f}%"],
            ["Selling Costs", f"${f.get('selling_costs', 0):,}"],
            ["Deal Score", f.get('deal_score', 'N/A')],
        ]
        fft = Table(flip_data, colWidths=[2.5 * inch, 3.5 * inch])
        fft.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(fft)
        story.append(Spacer(1, 0.2 * inch))

    risks = analysis_data.get("risks", [])
    if risks:
        story.append(Paragraph("Risk Assessment", heading2))
        for risk in risks:
            prefix = "✓" if risk.get("type") == "positive" else "⚠"
            color = colors.HexColor("#15803d") if risk.get("type") == "positive" else colors.HexColor("#b45309")
            p = Paragraph(
                f'<font color="#{color.hexval()[2:]}">{prefix}</font> {risk.get("message", "")}',
                normal,
            )
            story.append(p)
            story.append(Spacer(1, 0.05 * inch))
        story.append(Spacer(1, 0.1 * inch))

    if market:
        story.append(Paragraph("Market Context", heading2))
        mc_data = [
            ["Area", f"{market.location.city}, {market.location.state_code}" if market.location else "N/A"],
            ["Median Home Value", f"${market.economic_indicators.median_home_value:,}" if market.economic_indicators.median_home_value else "N/A"],
            ["YoY Appreciation", f"{market.price_trends.yoy_appreciation_pct:.1f}%" if market.price_trends.yoy_appreciation_pct else "N/A"],
            ["30yr Mortgage Rate", f"{market.economic_indicators.mortgage_rate_30yr:.2f}%" if market.economic_indicators.mortgage_rate_30yr else "N/A"],
            ["Median 2BR Rent", f"${market.rental_market.median_rent_2br:,}" if market.rental_market.median_rent_2br else "N/A"],
            ["Median Household Income", f"${market.demographics.median_household_income:,}" if market.demographics.median_household_income else "N/A"],
        ]
        mct = Table(mc_data, colWidths=[2.5 * inch, 3.5 * inch])
        mct.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eff6ff")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(mct)
        story.append(Spacer(1, 0.2 * inch))

    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph(
        "This report provides estimates for informational purposes only. "
        "Always conduct your own due diligence before making investment decisions. "
        "Projections are based on historical trends and may not reflect future performance.",
        small,
    ))

    doc.build(story)
    buf.seek(0)
    return buf
