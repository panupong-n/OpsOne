import { avatarColor, initials } from '../../../lib/avatar';

// One avatar for the whole app: same person → same colour everywhere.
// Renders an image when given, otherwise a colour-deterministic initials circle.

export type PersonAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<PersonAvatarSize, number> = {
    xs: 24,
    sm: 28,
    md: 32,
    lg: 40,
    xl: 56,
};

const FONT_PX: Record<PersonAvatarSize, number> = {
    xs: 9,
    sm: 10,
    md: 11,
    lg: 14,
    xl: 18,
};

interface PersonAvatarProps {
    /** Display name — drives the initials. */
    name: string;
    /** Stable key for the colour (user id / email). Falls back to name. */
    colorKey?: string;
    /** Optional photo URL. When present, shows the image instead of initials. */
    src?: string | null;
    size?: PersonAvatarSize;
    /** Extra ring around the avatar (useful on coloured backgrounds). */
    ring?: boolean;
    className?: string;
    title?: string;
    style?: React.CSSProperties;
}

export default function PersonAvatar({
    name,
    colorKey,
    src,
    size = 'md',
    ring = false,
    className = '',
    title,
    style,
}: PersonAvatarProps) {
    const px = SIZE_PX[size];
    const key = colorKey || name || '?';

    const base: React.CSSProperties = {
        width: px,
        height: px,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxShadow: ring ? '0 0 0 2px var(--color-surface)' : undefined,
        ...style,
    };

    if (src) {
        return (
            <div className={className} style={base} title={title ?? name}>
                <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
        );
    }

    return (
        <div
            className={className}
            title={title ?? name}
            style={{
                ...base,
                background: avatarColor(key),
                color: '#fff',
                fontWeight: 700,
                fontSize: FONT_PX[size],
                lineHeight: 1,
            }}
        >
            {initials(name)}
        </div>
    );
}
