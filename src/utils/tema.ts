/** Paleta de marca. Cambia solo estos tres valores para un cliente nuevo. */
export const COLORES = {
    primario: '#111827',
    secundario: '#4b5563',
    acento: '#2490D0',
} as const;

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
    const clean = String(hex || '').replace('#', '').trim();
    const full = clean.length === 3
        ? clean.split('').map((char) => char + char).join('')
        : clean;
    const value = Number.parseInt(full, 16);

    if (!Number.isFinite(value)) {
        return { r: 15, g: 5, b: 41 };
    }

    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
}

function rgbString(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    return `${r}, ${g}, ${b}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
    return {
        r: Math.round(from.r + (to.r - from.r) * amount),
        g: Math.round(from.g + (to.g - from.g) * amount),
        b: Math.round(from.b + (to.b - from.b) * amount),
    };
}

function rgbaFrom(rgb: Rgb, alpha: number) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function getColores() {
    return { ...COLORES };
}

export function estiloTemaInline() {
    const { primario, secundario, acento } = COLORES;

    return [
        `--primary-color: ${primario}`,
        `--primary-rgb: ${rgbString(primario)}`,
        `--secondary-color: ${secundario}`,
        `--secondary-rgb: ${rgbString(secundario)}`,
        `--accent-brand: ${acento}`,
        `--accent-rgb: ${rgbString(acento)}`,
    ].join('; ');
}

export function colorRgba(hex: string, alpha: number) {
    return `rgba(${rgbString(hex)}, ${alpha})`;
}

export function paletaGraficos() {
    const { primario, secundario, acento } = COLORES;
    const primary = hexToRgb(primario);
    const secondary = hexToRgb(secundario);
    const accent = hexToRgb(acento);
    const white = { r: 255, g: 255, b: 255 };

    return [
        rgbaFrom(accent, 0.92),
        rgbaFrom(mixRgb(accent, primary, 0.28), 0.9),
        rgbaFrom(mixRgb(accent, white, 0.25), 0.88),
        rgbaFrom(secondary, 0.88),
        rgbaFrom(mixRgb(accent, white, 0.45), 0.88),
        rgbaFrom(mixRgb(primary, secondary, 0.4), 0.86),
        rgbaFrom(mixRgb(accent, white, 0.62), 0.88),
        rgbaFrom(mixRgb(secondary, white, 0.45), 0.86),
    ];
}
