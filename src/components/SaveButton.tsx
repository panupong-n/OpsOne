import * as React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { green } from '@mui/material/colors';
import Button from '@mui/material/Button';
import Fab from '@mui/material/Fab';
import CheckIcon from '@mui/icons-material/Check';
import SaveIcon from '@mui/icons-material/Save';

interface SaveButtonProps {
    /** Label for the regular button. Defaults to "บันทึก" */
    label?: string;
    /** Called when user clicks save. May return a Promise — if it does, loading waits for it. */
    onSave?: () => void | Promise<void>;
    /** Show only the FAB (floating action button) without the wide button */
    fabOnly?: boolean;
}

export default function SaveButton({ label = 'บันทึก', onSave, fabOnly = false }: SaveButtonProps) {
    const [loading, setLoading] = React.useState(false);
    const [success, setSuccess] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

    const buttonSx = {
        ...(success && {
            bgcolor: green[500],
            '&:hover': { bgcolor: green[700] },
        }),
    };

    React.useEffect(() => {
        return () => { clearTimeout(timer.current); };
    }, []);

    const handleClick = async () => {
        if (loading) return;
        setSuccess(false);
        setLoading(true);
        try {
            if (onSave) {
                await onSave();
            }
            timer.current = setTimeout(() => {
                setSuccess(true);
                setLoading(false);
                // Reset success state after 2.5s
                setTimeout(() => setSuccess(false), 2500);
            }, 400);
        } catch {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* FAB */}
            <Box sx={{ m: 1, position: 'relative' }}>
                <Fab
                    aria-label="save"
                    color="primary"
                    sx={buttonSx}
                    onClick={handleClick}
                >
                    {success ? <CheckIcon /> : <SaveIcon />}
                </Fab>
                {loading && (
                    <CircularProgress
                        size={68}
                        sx={{
                            color: green[500],
                            position: 'absolute',
                            top: -6,
                            left: -6,
                            zIndex: 1,
                        }}
                    />
                )}
            </Box>

            {/* Wide button */}
            {!fabOnly && (
                <Box sx={{ m: 1, position: 'relative' }}>
                    <Button
                        variant="contained"
                        sx={buttonSx}
                        disabled={loading}
                        onClick={handleClick}
                    >
                        {success ? 'บันทึกแล้ว!' : label}
                    </Button>
                    {loading && (
                        <CircularProgress
                            size={24}
                            sx={{
                                color: green[500],
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                marginTop: '-12px',
                                marginLeft: '-12px',
                            }}
                        />
                    )}
                </Box>
            )}
        </Box>
    );
}
