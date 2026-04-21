-- Instructions for Supabase Dashboard:
-- 1. Go to the SQL Editor in your Supabase Dashboard
-- 2. Paste and run the following queries to enable Row Level Security

-- Add a user_id column to the assets table, defaulting to the authenticated user's ID
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL DEFAULT auth.uid();

-- Create a foreign key constraint linking to the auth.users table (optional but recommended)
-- ALTER TABLE public.assets ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- Enable Row Level Security
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- 1. Policy: Users can view their own assets (used in /scan and /assets endpoints)
CREATE POLICY "Users can view their own assets" 
ON public.assets 
FOR SELECT 
USING ( auth.uid() = user_id );

-- 2. Policy: Users can insert their own assets (used in /upload endpoint)
CREATE POLICY "Users can insert their own assets" 
ON public.assets 
FOR INSERT 
WITH CHECK ( auth.uid() = user_id );

-- 3. Policy: Users can update their own assets (if needed in the future)
CREATE POLICY "Users can update their own assets" 
ON public.assets 
FOR UPDATE 
USING ( auth.uid() = user_id ) 
WITH CHECK ( auth.uid() = user_id );

-- 4. Policy: Users can delete their own assets (if needed in the future)
CREATE POLICY "Users can delete their own assets" 
ON public.assets 
FOR DELETE 
USING ( auth.uid() = user_id );
