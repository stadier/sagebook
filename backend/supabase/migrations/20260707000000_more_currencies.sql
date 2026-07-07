-- =============================================================================
-- Sagebook · Broader currency coverage
-- -----------------------------------------------------------------------------
-- transactions.currency and accounts.currency have FKs to currencies(code):
-- an AI-extracted receipt in an unseeded currency (e.g. NGN) fails to insert.
-- Seed the currencies commonly seen in receipts/statements.
-- =============================================================================

insert into public.currencies (code, name, symbol, decimals) values
    ('NGN', 'Nigerian Naira',       '₦',   2),
    ('ZAR', 'South African Rand',   'R',   2),
    ('KES', 'Kenyan Shilling',      'KSh', 2),
    ('GHS', 'Ghanaian Cedi',        '₵',   2),
    ('EGP', 'Egyptian Pound',       'E£',  2),
    ('MAD', 'Moroccan Dirham',      'DH',  2),
    ('XOF', 'West African CFA Franc','CFA', 0),
    ('INR', 'Indian Rupee',         '₹',   2),
    ('AED', 'UAE Dirham',           'د.إ', 2),
    ('SAR', 'Saudi Riyal',          '﷼',   2),
    ('TRY', 'Turkish Lira',         '₺',   2),
    ('BRL', 'Brazilian Real',       'R$',  2),
    ('MXN', 'Mexican Peso',         'MX$', 2),
    ('SGD', 'Singapore Dollar',     'S$',  2),
    ('HKD', 'Hong Kong Dollar',     'HK$', 2),
    ('KRW', 'South Korean Won',     '₩',   0),
    ('SEK', 'Swedish Krona',        'kr',  2),
    ('NOK', 'Norwegian Krone',      'kr',  2),
    ('DKK', 'Danish Krone',         'kr',  2),
    ('PLN', 'Polish Złoty',         'zł',  2),
    ('NZD', 'New Zealand Dollar',   'NZ$', 2)
on conflict (code) do nothing;
