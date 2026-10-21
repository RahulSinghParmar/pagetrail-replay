"""Invented attachment fixtures only; never reads user notes or browser data."""
from pathlib import Path
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw

root = Path("test/artifacts/affine-validation")
root.mkdir(parents=True, exist_ok=True)
pdf = canvas.Canvas(str(root / "synthetic-reference.pdf"), pagesize=(420, 300))
pdf.setTitle("PageTrail Test - Synthetic attachment")
pdf.setFillColorRGB(0.1, 0.3, 0.24)
pdf.setFont("Helvetica-Bold", 20)
pdf.drawString(30, 250, "PageTrail Test")
pdf.setFont("Helvetica", 12)
pdf.drawString(30, 220, "Synthetic content - attachment validation only")
pdf.drawString(30, 175, "Reference code: PT-ATTACHMENT-042")
pdf.drawString(30, 150, "This file contains no employer or personal data.")
pdf.drawString(30, 70, "Check: this sentence survives export and import.")
pdf.showPage()
pdf.save()
image = Image.new("RGB", (360, 140), "#edf4ef")
draw = ImageDraw.Draw(image)
draw.rectangle((16, 16, 344, 124), outline="#21624c", width=3)
draw.text((35, 45), "PAGETRAIL TEST - SYNTHETIC PNG", fill="#193e31")
draw.text((35, 80), "IMAGE CHECK 042", fill="#193e31")
image.save(root / "synthetic-diagram.png")
