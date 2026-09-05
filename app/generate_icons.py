"""Generate app icons for the Course Manager PWA."""
from PIL import Image, ImageDraw
import math

def create_gradient(size, color1, color2):
    """Create a diagonal gradient image."""
    img = Image.new('RGBA', (size, size), color1)
    draw = ImageDraw.Draw(img)
    for i in range(size):
        # Interpolate colors
        t = i / size
        r = int(color1[0] + (color2[0] - color1[0]) * t)
        g = int(color1[1] + (color2[1] - color1[1]) * t)
        b = int(color1[2] + (color2[2] - color1[2]) * t)
        draw.line([(i, 0), (i, size)], fill=(r, g, b, 255))
    # Blend horizontally as well for diagonal effect
    img2 = Image.new('RGBA', (size, size), color1)
    draw2 = ImageDraw.Draw(img2)
    for i in range(size):
        t = i / size
        r = int(color1[0] + (color2[0] - color1[0]) * t)
        g = int(color1[1] + (color2[1] - color1[1]) * t)
        b = int(color1[2] + (color2[2] - color1[2]) * t)
        draw2.line([(0, i), (size, i)], fill=(r, g, b, 255))
    return Image.blend(img, img2, 0.5)

def draw_rounded_rect(draw, bbox, radius, fill):
    """Draw a rounded rectangle."""
    x0, y0, x1, y1 = bbox
    draw.rounded_rectangle(bbox, radius=radius, fill=fill)

def draw_book(draw, cx, cy, size, color):
    """Draw a simple book icon centered at (cx, cy)."""
    w = int(size * 0.7)
    h = int(size * 0.55)
    # Book body
    x0 = cx - w // 2
    y0 = cy - h // 2
    x1 = cx + w // 2
    y1 = cy + h // 2
    # Shadow
    draw.rounded_rectangle([x0+3, y0+5, x1+3, y1+5], radius=int(h*0.1), fill=(0, 0, 0, 40))
    # Book
    draw.rounded_rectangle([x0, y0, x1, y1], radius=int(h*0.1), fill=color)
    # Spine
    spine_w = max(4, int(w * 0.08))
    draw.rounded_rectangle([cx - spine_w//2, y0, cx + spine_w//2, y1], radius=2, fill=(255, 255, 255, 80))
    # Lines (pages)
    line_color = (79, 70, 229, 180)
    for i in range(2):
        ly = y0 + int(h * (0.35 + i * 0.3))
        draw.line([x0 + int(w*0.15), ly, cx - spine_w, ly], fill=line_color, width=max(2, int(size*0.025)))
        draw.line([cx + spine_w, ly, x1 - int(w*0.15), ly], fill=line_color, width=max(2, int(size*0.025)))

def draw_graduation_cap(draw, cx, cy, size, color):
    """Draw a graduation cap centered at (cx, cy)."""
    s = size
    # Cap top (diamond shape)
    points = [
        (cx, cy - int(s*0.25)),
        (cx + int(s*0.4), cy - int(s*0.05)),
        (cx, cy + int(s*0.05)),
        (cx - int(s*0.4), cy - int(s*0.05)),
    ]
    draw.polygon(points, fill=color)
    # Cap band (trapezoid)
    band_top = cy + int(s*0.05)
    band_bot = cy + int(s*0.2)
    band_pts = [
        (cx - int(s*0.18), band_top),
        (cx + int(s*0.18), band_top),
        (cx + int(s*0.15), band_bot),
        (cx - int(s*0.15), band_bot),
    ]
    draw.polygon(band_pts, fill=color)
    # Tassel
    tassel_x = cx + int(s*0.4)
    tassel_y = cy - int(s*0.05)
    draw.line([tassel_x, tassel_y, tassel_x + int(s*0.05), tassel_y + int(s*0.15)], fill=color, width=max(2, int(s*0.025)))
    # Tassel ball
    draw.ellipse([tassel_x + int(s*0.03), tassel_y + int(s*0.13), tassel_x + int(s*0.08), tassel_y + int(s*0.2)], fill=color)

def generate_icon(size, maskable=False):
    """Generate an icon at the given size."""
    # Colors
    color1 = (79, 70, 229, 255)   # #4F46E5
    color2 = (99, 102, 241, 255)  # #6366F1
    white = (255, 255, 255, 255)

    # Background
    if maskable:
        # Full bleed background for maskable icons
        img = create_gradient(size, color1, color2)
        # Scale factor for safe zone (80% for maskable)
        icon_size = int(size * 0.5)
        offset = (size - icon_size) // 2
        draw = ImageDraw.Draw(img)
        draw_graduation_cap(draw, size // 2, size // 2 - int(size*0.05), icon_size, white)
        # Add a book below the cap
        book_size = int(size * 0.35)
        draw_book(draw, size // 2, size // 2 + int(size*0.18), book_size, white)
    else:
        # Standard icon with rounded background
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        # Draw rounded rect background
        draw = ImageDraw.Draw(img)
        radius = int(size * 0.22)
        # Use gradient fill
        gradient = create_gradient(size, color1, color2)
        # Create mask for rounded rect
        mask = Image.new('L', (size, size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=255)
        img.paste(gradient, (0, 0), mask)

        # Draw graduation cap
        icon_size = int(size * 0.55)
        draw_graduation_cap(ImageDraw.Draw(img), size // 2, size // 2 - int(size*0.03), icon_size, white)
        # Draw book below
        book_size = int(size * 0.4)
        draw_book(ImageDraw.Draw(img), size // 2, size // 2 + int(size*0.2), book_size, white)

    return img

def main():
    output_dir = '/Users/liyong/Library/Mobile Documents/com~apple~CloudDocs/资料/WorkBuddy/3-课程管理系统/app/icons'

    sizes = [192, 512]
    for s in sizes:
        # Standard icon
        icon = generate_icon(s, maskable=False)
        icon.save(f'{output_dir}/icon-{s}.png', 'PNG')
        print(f'Generated icon-{s}.png')

        # Maskable icon
        icon_m = generate_icon(s, maskable=True)
        icon_m.save(f'{output_dir}/icon-maskable-{s}.png', 'PNG')
        print(f'Generated icon-maskable-{s}.png')

    # Also generate a 32x32 favicon
    icon_small = generate_icon(32, maskable=False)
    icon_small.save(f'{output_dir}/icon-32.png', 'PNG')
    print('Generated icon-32.png')

    # Generate apple-touch-icon (180x180)
    icon_apple = generate_icon(180, maskable=False)
    icon_apple.save(f'{output_dir}/icon-180.png', 'PNG')
    print('Generated icon-180.png')

    print('\nAll icons generated successfully!')

if __name__ == '__main__':
    main()
