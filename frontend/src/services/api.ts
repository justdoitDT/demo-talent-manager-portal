// frontend/src/services/api.ts

import axios from 'axios';
import { supabase } from './supabase';


const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
});

// Attach Supabase access token if logged in
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;