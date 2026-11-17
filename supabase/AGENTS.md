# Database and storage policies

- Use versioned PostgreSQL migrations, constraints, indexes, least-privilege roles and deny-by-default client isolation.
- Apply RLS to client-owned tables and private storage policies. Prevent client changes to roles/status or financial records.
- Keep audit/history records and financial writes consistent. Archive or correct financial records rather than deleting history.
- Document Supabase-specific identity functions and their Azure PostgreSQL equivalents; never assume they are portable.
- Seed only clearly labeled synthetic data. Test fresh migration, constraints, client A/B isolation, admin access and private-file permissions.
