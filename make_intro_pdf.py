"""
產生「千張大戶持股追蹤器_介紹.pdf」介紹文件。
在 Windows 上執行：python make_intro_pdf.py
會自動從 C:\\Windows\\Fonts 讀取微軟正黑體並嵌入 PDF。
"""
import os
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# === 字型註冊（嵌入到 PDF，不依賴觀看者系統）===
FONT_CANDIDATES = [
    # Windows 內建字型
    (r"C:\Windows\Fonts\msjh.ttc", 0),      # 微軟正黑體
    (r"C:\Windows\Fonts\msjhbd.ttc", 0),    # 微軟正黑體 Bold
    (r"C:\Windows\Fonts\mingliu.ttc", 0),   # 細明體（備用）
]
for path, sub in FONT_CANDIDATES:
    if os.path.exists(path):
        try:
            pdfmetrics.registerFont(TTFont('TC', path, subfontIndex=sub))
            print(f"已嵌入字型: {path}")
            break
        except Exception as e:
            print(f"無法讀取 {path}: {e}")
else:
    # Windows 以外或找不到 → fallback CID
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont('MSung-Light'))
    pdfmetrics.registerFont(UnicodeCIDFont('MSung-Light'))
    globals()['TC'] = 'MSung-Light'
    print("找不到 Windows 字型，用 CID fallback（可能部分 viewer 空白）")

FONT = 'TC'

# 色票
COLOR_TEXT   = HexColor('#1F2937')
COLOR_MUTED  = HexColor('#6B7280')
COLOR_ACCENT = HexColor('#0EA5E9')
COLOR_TITLE  = HexColor('#111827')
COLOR_BORDER = HexColor('#E5E7EB')
COLOR_BOX_BG = HexColor('#F3F4F6')

OUT = Path(__file__).parent / '千張大戶持股追蹤器_介紹.pdf'

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm,
    topMargin=20*mm, bottomMargin=20*mm,
    title="千張大戶持股追蹤器", author="Derek",
)

title_style = ParagraphStyle('T', fontName=FONT, fontSize=26, leading=34,
    textColor=COLOR_TITLE, alignment=TA_LEFT, spaceAfter=8)
subtitle_style = ParagraphStyle('St', fontName=FONT, fontSize=11, leading=16,
    textColor=COLOR_MUTED, alignment=TA_LEFT, spaceAfter=16)
h2_style = ParagraphStyle('H2', fontName=FONT, fontSize=16, leading=22,
    textColor=COLOR_ACCENT, spaceBefore=18, spaceAfter=8)
body_style = ParagraphStyle('B', fontName=FONT, fontSize=11, leading=19,
    textColor=COLOR_TEXT, alignment=TA_LEFT, spaceAfter=10)
bullet_style = ParagraphStyle('Bu', parent=body_style, leftIndent=16,
    bulletIndent=4, spaceAfter=6)
url_style = ParagraphStyle('U', fontName=FONT, fontSize=12,
    textColor=COLOR_ACCENT, alignment=TA_CENTER)
disclaimer_style = ParagraphStyle('D', fontName=FONT, fontSize=9, leading=14,
    textColor=COLOR_MUTED, alignment=TA_LEFT)

story = []
story.append(Paragraph('千張大戶，你在看什麼？', title_style))
story.append(Paragraph(
    '一個追蹤大戶增持動向的情報看板 / Taiwan Stock Scanner', subtitle_style))
story.append(HRFlowable(width="100%", thickness=1.2, color=COLOR_ACCENT,
    spaceBefore=4, spaceAfter=14))

story.append(Paragraph('起心動念', h2_style))
story.append(Paragraph(
    '要感謝 Joy88 做了一個追蹤基金持股權重的網站，讓我大開眼界——'
    '原來現在自己搞個網頁不是不可能。', body_style))
story.append(Paragraph(
    '於是我問自己：如果 ETF 經理人的動向值得追蹤，那千張大股東的動向呢？',
    body_style))
story.append(Paragraph(
    '千張大股東，也就是持有超過一千張的大戶，他們的持股變化每週都會公開揭露。'
    '這些人動用的資金規模龐大，不太可能隨意進出，'
    '每一次增持都代表某種程度的信心。', body_style))
story.append(Paragraph('所以我做了這個工具：<b>千張大戶持股追蹤器</b>。', body_style))

story.append(Paragraph('它做了什麼', h2_style))
story.append(Paragraph(
    '每週自動從公開資料抓取千張大股東增持名單，依族群分類，'
    '呈現每支股票的 K 線走勢、多期間漲幅（1 週／1 月／3 月／半年／1 年可切換）、'
    '月營收年增率，以及毛利率、營業利益率、EPS 的季年增率走勢，'
    '讓你一眼看出大戶這週在佈局哪些族群、K 線是不是在右上角。', body_style))

story.append(Paragraph('怎麼用？', h2_style))
url_tbl = Table([[Paragraph(
    '<link href="https://taiwan-stock-scanner.pages.dev" color="#0EA5E9">'
    '<b>https://taiwan-stock-scanner.pages.dev</b></link>', url_style)]],
    colWidths=[170*mm])
url_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), COLOR_BOX_BG),
    ('BOX', (0,0), (-1,-1), 1, COLOR_ACCENT),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(url_tbl)
story.append(Spacer(1, 10))
story.append(Paragraph('預設按「均增持幅度」排序，增持最積極的族群排在最前面。',
    body_style))
story.append(Spacer(1, 4))
story.append(Paragraph('<b>兩種檢視模式：</b>', body_style))
story.append(Paragraph(
    '• <b>族群總覽</b>：點開任何一個族群，就能看到裡面每支股票的 K 線圖，'
    '搭配週增持幅度和一年漲幅。', bullet_style))
story.append(Paragraph(
    '• <b>個股列表</b>：一張表看全部股票，點開任一列可以看到 K 線 + 基本面 4 分頁'
    '（月營收／毛利率／營業利益率／EPS 年增率），'
    '快速掃描一支股票的中長期基本面趨勢。', bullet_style))
story.append(Spacer(1, 4))
story.append(Paragraph(
    '上方也能切換漲幅期間，搭配搜尋（代號／名稱／族群）快速定位。', body_style))

story.append(Paragraph('一個提醒', h2_style))
warn_tbl = Table([[Paragraph(
    '<b>這不是選股系統，沒有買賣建議。</b>'
    '它只是一個「情報看板」，讓你知道有哪些股票正在被大資金悄悄關注，'
    '至於要不要進場，還是得靠自己的判斷。', body_style)]],
    colWidths=[170*mm])
warn_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), HexColor('#FEF3C7')),
    ('LINEBEFORE', (0,0), (-1,-1), 3, HexColor('#F59E0B')),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ('TOPPADDING', (0,0), (-1,-1), 12),
    ('BOTTOMPADDING', (0,0), (-1,-1), 12),
]))
story.append(warn_tbl)
story.append(Spacer(1, 12))
story.append(Paragraph(
    '如果你也對大戶動向感興趣，歡迎試用，有任何回饋都很歡迎。🙏', body_style))

story.append(Spacer(1, 20))
story.append(HRFlowable(width="100%", thickness=0.5, color=COLOR_BORDER,
    spaceBefore=4, spaceAfter=10))
story.append(Paragraph('免責聲明', ParagraphStyle('DT', parent=h2_style,
    fontSize=12, textColor=COLOR_MUTED, spaceBefore=4, spaceAfter=6)))
story.append(Paragraph(
    '本網站資料來源為公開資訊（公開資訊觀測站、Yahoo Finance、FinMind 等），'
    '僅供學習與研究參考，不構成任何投資建議。'
    '使用者應自行評估投資風險並為自身投資決策負責。'
    '本工具為業餘專案，資料可能因來源網站變動而有延遲或錯誤，概不負責。',
    disclaimer_style))
story.append(Spacer(1, 4))
story.append(Paragraph('投資有風險，交易前請詳閱公開說明書。', disclaimer_style))

doc.build(story)
print(f"完成：{OUT} ({OUT.stat().st_size:,} bytes)")
