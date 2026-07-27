// PM2 process config — TEMPLATE.
// Copy this file to the project root as `ecosystem.config.cjs` and fill in the
// real values. The real file is gitignored so secrets never reach the repo.
//
//   cp deploy/ecosystem.config.example.cjs ecosystem.config.cjs
//   # edit ecosystem.config.cjs, then:
//   pm2 start ecosystem.config.cjs
//
// Never commit real passwords/tokens. Rotate any value that has ever been shared.

module.exports = {
    apps: [
        {
            name: 'opsone',
            script: './server.js',
            cwd: '/home/opsone/OpsOne',
            interpreter: 'node',
            interpreter_args: '--experimental-vm-modules',
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            env: {
                NODE_ENV: 'production',
                PORT: '3000',
                HTTPS_PORT: '443',
                TENCYBER_URL: 'https://dashboard.tenfw.com',
                DB_HOST: 'localhost',
                DB_NAME: 'opsone_db',
                DB_USER: 'opsone',
                DB_PASS: '__SET_ME__',
                ZAMMAD_URL: 'https://ticket.tenfw.com',
                ZAMMAD_TOKEN: '__SET_ME__',
                ALLOWED_ORIGINS: 'https://opsone.tenfw.com,https://opsone.opsoneco.com',
                SURVEY_SMTP_HOST: 'smtp.office365.com',
                SURVEY_SMTP_PORT: '587',
                SURVEY_SMTP_USER: 'you@example.com',
                SURVEY_SMTP_PASS: '__SET_ME__',
                SURVEY_SMTP_ACCOUNTS: JSON.stringify([
                    { email: 'sender@example.com', pass: '__SET_ME__', label: 'Sender label' }
                ]),
                SURVEY_FRONTEND_URL: 'https://opsone.tenfw.com',
                SURVEY_TOKEN_EXPIRY_DAYS: '7',
            },
            error_file: '/home/opsone/OpsOne/logs/opsone-error.log',
            out_file: '/home/opsone/OpsOne/logs/opsone-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            restart_delay: 3000,
            max_restarts: 10,
        },
    ],
};
