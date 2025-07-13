export interface User {
  id: string;
  email: string;
  role: 'student' | 'staff';
  full_name: string;
  registration_number?: string;
  mobile_number: string;
  created_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  category: string;
  serves: number;
  canteen_name: string;
  rating: number;
  quantity_available: number;
  created_at: string;
}

export interface CartItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  menu_item: MenuItem;
}

export interface Order {
  id: string;
  user_id: string;
  total_amount: number;
  status: 'pending' | 'processing' | 'ready' | 'completed';
  created_at: string;
  user: User;
  order_items: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  quantity: number;
  price: number;
  menu_item: MenuItem;
}