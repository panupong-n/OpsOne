import { DatePicker, ConfigProvider } from 'antd';
import type { DatePickerProps } from 'antd';
import th_TH from 'antd/locale/th_TH';
import dayjs from 'dayjs';
import 'dayjs/locale/th';
import buddhistEra from 'dayjs/plugin/buddhistEra';

dayjs.extend(buddhistEra);
dayjs.locale('th');

// Safely extract DatePicker locale; fall back to empty objects when undefined
const baseDatePicker = th_TH.DatePicker ?? {};
const baseLang = (baseDatePicker as Record<string, unknown>).lang ?? {};

// Ant Design locale with Buddhist Era year format
const thBuddhistLocale: typeof th_TH = {
    ...th_TH,
    DatePicker: {
        ...baseDatePicker,
        lang: {
            ...(baseLang as Record<string, unknown>),
            locale: 'th',
            yearFormat: 'BBBB',
            cellYearFormat: 'BBBB',
            fieldDateFormat: 'DD/MM/BBBB',
            fieldDateTimeFormat: 'DD/MM/BBBB HH:mm',
        },
    } as typeof th_TH.DatePicker,
};

interface ThaiDatePickerProps {
    value?: string | null;
    onChange?: (dateStr: string | null) => void;
    placeholder?: string;
    className?: string;
    size?: DatePickerProps['size'];
    style?: React.CSSProperties;
    allowClear?: boolean;
    disabled?: boolean;
}

export default function ThaiDatePicker({ value, onChange, placeholder = 'เลือกวันที่', className, size = 'middle', style, allowClear = true, disabled }: ThaiDatePickerProps) {
    const dayjsValue = value ? dayjs(value) : null;
    const sizeClass = size === 'small' ? ' thai-datepicker-sm' : '';

    return (
        <ConfigProvider locale={thBuddhistLocale}>
            <DatePicker
                value={dayjsValue}
                onChange={(d) => onChange?.(d ? d.format('YYYY-MM-DD') : null)}
                format="DD/MM/BBBB"
                placeholder={placeholder}
                className={`thai-datepicker${sizeClass}${className ? ' ' + className : ''}`}
                size={size}
                style={{ width: '100%', ...style }}
                allowClear={allowClear}
                disabled={disabled}
                popupClassName="thai-datepicker-popup"
            />
        </ConfigProvider>
    );
}

// Helper: format a date string to Thai Buddhist Era display
export function formatThaiDate(dateStr: string | null | undefined, includeWeekday = false): string {
    if (!dateStr) return '—';
    const d = dayjs(dateStr);
    if (!d.isValid()) return '—';
    if (includeWeekday) {
        return d.format('dddd D MMMM BBBB');
    }
    return d.format('D MMM BBBB');
}

// Helper: format a date string to short Thai display (for tables)
export function formatThaiDateShort(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';
    const d = dayjs(dateStr);
    if (!d.isValid()) return '—';
    return d.format('DD/MM/BB');
}
