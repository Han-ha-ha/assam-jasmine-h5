from __future__ import annotations

from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from psd_tools import PSDImage


ROOT = Path(__file__).resolve().parents[1]
PSD_PATH = ROOT / "素材3" / "广州站源文件" / "广州站-竖版艺人合集.psd"
LANDSCAPE_PSD_PATH = ROOT / "素材3" / "广州站源文件" / "横构图.psd"
CUSTOMER_DRAW_PSD_PATH = ROOT / "素材3" / "750x1624px-首页背景.psd"
HOME_DIR = ROOT / "assets" / "home"
SHARE_DIR = ROOT / "assets" / "share"
DRAW_DIR = ROOT / "assets" / "draw"
FONT_BODY = ROOT / "字体文件" / "方正粗倩简体.ttf"
FONT_SANS = ROOT / "字体文件" / "SourceHanSansCN-H5.woff2"
FALLBACK_FONT = ROOT / "字体文件" / "胡晓波浪漫宋.ttf"
H5_URL = "https://han-ha-ha.github.io/assam-jasmine-h5/"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    candidates = (path, FALLBACK_FONT, Path("C:/Windows/Fonts/msyh.ttc"))
    for candidate in candidates:
        try:
            return ImageFont.truetype(str(candidate), size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def fit(image: Image.Image, max_width: int, max_height: int | None = None) -> Image.Image:
    limit_height = max_height or 100_000
    ratio = min(max_width / image.width, limit_height / image.height)
    size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
    return image.resize(size, Image.Resampling.LANCZOS)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    ratio = max(size[0] / image.width, size[1] / image.height)
    scaled = image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.Resampling.LANCZOS,
    )
    left = (scaled.width - size[0]) // 2
    top = (scaled.height - size[1]) // 2
    return scaled.crop((left, top, left + size[0], top + size[1]))


def centered_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, text_font, fill):
    box = draw.textbbox((0, 0), text, font=text_font)
    draw.text((xy[0] - (box[2] - box[0]) / 2, xy[1]), text, font=text_font, fill=fill)


def rounded_ticket(size: tuple[int, int]) -> tuple[Image.Image, Image.Image]:
    width, height = size
    mask = Image.new("L", size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=44, fill=255)
    notch_y = round(height * 0.62)
    notch_radius = 34
    mask_draw.ellipse(
        (-notch_radius, notch_y - notch_radius, notch_radius, notch_y + notch_radius),
        fill=0,
    )
    mask_draw.ellipse(
        (width - notch_radius, notch_y - notch_radius, width + notch_radius, notch_y + notch_radius),
        fill=0,
    )

    ticket = Image.new("RGBA", size, (255, 253, 240, 0))
    ticket.putalpha(mask)
    return ticket, mask


def build() -> None:
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    SHARE_DIR.mkdir(parents=True, exist_ok=True)
    DRAW_DIR.mkdir(parents=True, exist_ok=True)

    psd = PSDImage.open(PSD_PATH)
    artboard = list(psd)[0]
    layers = {layer.name: layer for layer in artboard}

    full_kv = psd.composite().convert("RGB")
    home_kv = full_kv.resize((1080, 1920), Image.Resampling.LANCZOS)
    home_kv.save(HOME_DIR / "guangzhou-kv-9x16.webp", "WEBP", quality=88, method=6)

    landscape_kv = PSDImage.open(LANDSCAPE_PSD_PATH).composite().convert("RGB")
    landscape_kv = landscape_kv.resize((1280, 720), Image.Resampling.LANCZOS)
    landscape_kv.save(HOME_DIR / "guangzhou-kv-16x9.webp", "WEBP", quality=88, method=6)

    background = layers["背景"].composite().convert("RGB")
    title = layers["标题 "].composite().convert("RGBA")
    bottle = layers["瓶子"].composite().convert("RGBA")

    poster_size = (1080, 1920)
    poster = cover(background, poster_size).filter(ImageFilter.GaussianBlur(1.3)).convert("RGBA")
    poster = Image.blend(
        poster,
        Image.new("RGBA", poster_size, (225, 246, 207, 255)),
        0.10,
    )
    poster.convert("RGB").save(
        DRAW_DIR / "poster-background.webp",
        "WEBP",
        quality=90,
        method=6,
    )

    # 客户提供的抽奖页竖版背景：仅关闭蓝色提示栏、栏中文字和左侧红色剩余次数牌。
    customer_draw_psd = PSDImage.open(CUSTOMER_DRAW_PSD_PATH)
    customer_draw_layers = list(customer_draw_psd)
    for layer_index in (4, 5, 6):
        customer_draw_layers[layer_index].visible = False
    customer_draw_background = customer_draw_psd.composite().convert("RGB")
    customer_draw_background.save(
        DRAW_DIR / "customer-draw-background.webp",
        "WEBP",
        quality=90,
        method=6,
    )

    # 顶部保留官方活动视觉。
    title_small = fit(title, 750, 430)
    poster.alpha_composite(title_small, ((poster.width - title_small.width) // 2, 66))

    # 票根主体：不使用参考图中的其他品牌元素，重新制作阿萨姆版本。
    ticket_size = (760, 970)
    ticket, ticket_mask = rounded_ticket(ticket_size)
    ticket_draw = ImageDraw.Draw(ticket)
    green = (38, 116, 62, 255)
    dark_green = (16, 70, 43, 255)
    coral = (238, 111, 91, 255)
    pale_green = (230, 244, 205, 255)
    gold = (240, 190, 67, 255)

    ticket_draw.rounded_rectangle((42, 38, 718, 124), radius=35, fill=green)
    centered_text(ticket_draw, (380, 50), "统一阿萨姆 · 茉莉奶绿", font(FONT_BODY, 38), "white")
    centered_text(ticket_draw, (380, 160), "好心情音乐会广州站", font(FONT_BODY, 60), dark_green)
    centered_text(ticket_draw, (380, 236), "找奶绿  赢门票", font(FONT_BODY, 82), coral)
    centered_text(ticket_draw, (380, 335), "找到5个茉莉奶绿，解锁幸运抽奖", font(FONT_BODY, 29), dark_green)

    ticket_draw.rounded_rectangle((66, 398, 694, 548), radius=26, fill=pale_green)
    ticket_draw.text((94, 425), "DATE", font=font(FONT_BODY, 25), fill=green)
    ticket_draw.text((210, 418), "2026.09.19  19:00-21:00", font=font(FONT_BODY, 32), fill=dark_green)
    ticket_draw.text((94, 482), "VENUE", font=font(FONT_BODY, 25), fill=green)
    ticket_draw.text((210, 478), "广州大学城体育中心2号副场", font=font(FONT_BODY, 27), fill=dark_green)

    dashed_y = 604
    for x in range(55, 705, 30):
        ticket_draw.line((x, dashed_y, x + 16, dashed_y), fill=(86, 139, 81, 190), width=3)

    qr = qrcode.QRCode(version=None, box_size=9, border=2)
    qr.add_data(H5_URL)
    qr.make(fit=True)
    qr_image = qr.make_image(fill_color="#194d2f", back_color="#fffdf0").convert("RGBA")
    qr_image = qr_image.resize((230, 230), Image.Resampling.NEAREST)
    ticket.alpha_composite(qr_image, (90, 660))

    ticket_draw = ImageDraw.Draw(ticket)
    ticket_draw.text((355, 674), "扫码进入活动", font=font(FONT_BODY, 38), fill=dark_green)
    ticket_draw.text((355, 728), "GOOD MOOD", font=font(FONT_BODY, 28), fill=coral)
    ticket_draw.text((355, 776), "分享好心情", font=font(FONT_BODY, 48), fill=green)
    ticket_draw.rounded_rectangle((355, 848, 650, 910), radius=28, fill=gold)
    centered_text(ticket_draw, (503, 860), "广州站限定票根", font(FONT_BODY, 27), dark_green)

    shadow = Image.new("RGBA", ticket_size, (0, 0, 0, 0))
    shadow.putalpha(ticket_mask.filter(ImageFilter.GaussianBlur(28)))
    shadow_color = Image.new("RGBA", ticket_size, (16, 58, 35, 95))
    shadow_color.putalpha(shadow.getchannel("A"))

    angle = -3.2
    rotated_shadow = shadow_color.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    rotated_ticket = ticket.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    ticket_x = (poster.width - rotated_ticket.width) // 2
    ticket_y = 520
    poster.alpha_composite(rotated_shadow, (ticket_x + 18, ticket_y + 28))
    poster.alpha_composite(rotated_ticket, (ticket_x, ticket_y))

    # 产品和吉祥物加强品牌识别，同时避开二维码。
    bottle_small = fit(bottle, 360, 520)
    poster.alpha_composite(bottle_small, (680, 1260))

    footer = Image.new("RGBA", (960, 118), (255, 255, 255, 218))
    footer_draw = ImageDraw.Draw(footer)
    footer_draw.rounded_rectangle((0, 0, 959, 117), radius=54, outline=(255, 255, 255, 245), width=4)
    centered_text(footer_draw, (480, 24), "长按保存海报  ·  分享好心情", font(FONT_BODY, 44), dark_green)
    poster.alpha_composite(footer, (60, 1760))

    poster.convert("RGB").save(SHARE_DIR / "ticket-share-poster.jpg", "JPEG", quality=92, optimize=True, progressive=True)

    print(f"Built {HOME_DIR / 'guangzhou-kv-9x16.webp'}")
    print(f"Built {HOME_DIR / 'guangzhou-kv-16x9.webp'}")
    print(f"Built {SHARE_DIR / 'ticket-share-poster.jpg'}")
    print(f"Built {DRAW_DIR / 'poster-background.webp'}")
    print(f"Built {DRAW_DIR / 'customer-draw-background.webp'}")


if __name__ == "__main__":
    build()
