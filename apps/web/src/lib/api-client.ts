const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export const MOCK_ORG_ID = 'mock-org-id';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | undefined>;
}

export async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...init } = options;

  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined) {
        searchParams.append(key, String(val));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API error: ${response.status}`);
  }

  return response.json();
}

export const tournamentApi = {
  create: (dto: any) =>
    apiFetch<any>(`/api/v1/organizations/${MOCK_ORG_ID}/tournaments`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  list: (params?: any) =>
    apiFetch<any>(`/api/v1/organizations/${MOCK_ORG_ID}/tournaments`, {
      params,
    }),
  get: (id: string) =>
    apiFetch<any>(`/api/v1/organizations/${MOCK_ORG_ID}/tournaments/${id}`),
  update: (id: string, dto: any) =>
    apiFetch<any>(`/api/v1/organizations/${MOCK_ORG_ID}/tournaments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  publish: (id: string) =>
    apiFetch<any>(`/api/v1/organizations/${MOCK_ORG_ID}/tournaments/${id}/publish`, {
      method: 'PATCH',
    }),
  delete: (id: string) =>
    apiFetch<any>(`/api/v1/organizations/${MOCK_ORG_ID}/tournaments/${id}`, {
      method: 'DELETE',
    }),
};
