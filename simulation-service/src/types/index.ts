export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}

export interface PaginationOptions {
    page?: number;
    limit?: number;
}

export interface SortOptions {
    field: string;
    order: 'ASC' | 'DESC';
}