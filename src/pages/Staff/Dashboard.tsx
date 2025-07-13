import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Clock, CheckCircle, AlertCircle, Package, X, DollarSign, Users, Package2, Crown, Shield, Coffee } from 'lucide-react';
import Header from '../../components/Layout/Header';
import Toast from '../../components/Common/Toast';
import ThemeToggle from '../../components/Common/ThemeToggle';
import { MenuItem, Order } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error';
}

const StaffDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'orders' | 'menu'>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [updatingOrders, setUpdatingOrders] = useState<Set<string>>(new Set());
  const [savingMenuItem, setSavingMenuItem] = useState(false);
  const [deletingMenuItem, setDeletingMenuItem] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    price: '',
    image_url: '',
    category: '',
    serves: '',
    canteen_name: '',
    quantity_available: ''
  });

  const showToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  useEffect(() => {
    fetchOrders();
    fetchMenuItems();
  }, []);

  useEffect(() => {
    if (editingItem) {
      setEditForm({
        name: editingItem.name,
        description: editingItem.description,
        price: editingItem.price.toString(),
        image_url: editingItem.image_url,
        category: editingItem.category,
        serves: editingItem.serves.toString(),
        canteen_name: editingItem.canteen_name,
        quantity_available: editingItem.quantity_available.toString()
      });
    } else {
      setEditForm({
        name: '',
        description: '',
        price: '',
        image_url: '',
        category: 'main_course',
        serves: '1',
        canteen_name: user?.full_name || '',
        quantity_available: '0'
      });
    }
  }, [editingItem, user]);

  const fetchOrders = async () => {
    try {
      if (!user?.full_name) {
        console.error('Staff user full_name not available');
        setLoading(false);
        return;
      }

      const { data: allOrders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      if (!allOrders || allOrders.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      const userIds = [...new Set(allOrders.map(order => order.user_id))];
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .in('id', userIds);

      if (usersError) throw usersError;

      const orderIds = allOrders.map(order => order.id);
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('order_items')
        .select(`
          *,
          menu_item:menu_items(*)
        `)
        .in('order_id', orderIds);

      if (orderItemsError) throw orderItemsError;

      const userMap = new Map();
      users?.forEach(user => {
        userMap.set(user.id, user);
      });

      const relevantOrders = allOrders.filter(order => {
        const orderItemsForOrder = orderItems?.filter(item => item.order_id === order.id) || [];
        return orderItemsForOrder.some(item => 
          item.menu_item?.canteen_name === user.full_name
        );
      });

      const finalOrders = relevantOrders.map(order => {
        const userData = userMap.get(order.user_id);
        const canteenOrderItems = orderItems?.filter(item => 
          item.order_id === order.id && 
          item.menu_item?.canteen_name === user.full_name
        ) || [];

        const canteenTotal = canteenOrderItems.reduce((sum, item) => 
          sum + (item.price * item.quantity), 0
        );

        return {
          ...order,
          user: userData || null,
          order_items: canteenOrderItems,
          total_amount: canteenTotal
        };
      });

      setOrders(finalOrders);

    } catch (error) {
      console.error('Error in fetchOrders:', error);
      showToast('Failed to fetch orders. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchMenuItems = async () => {
    try {
      if (!user?.full_name) return;

      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('canteen_name', user.full_name)
        .order('name');

      if (error) throw error;
      setMenuItems(data || []);
    } catch (error) {
      console.error('Error fetching menu items:', error);
    }
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    const updateKey = `${orderId}-${status}`;
    
    if (updatingOrders.has(updateKey)) return;

    setUpdatingOrders(prev => new Set(prev).add(updateKey));
    
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', orderId);

      if (error) throw error;
      
      if (status === 'ready') {
        showToast('Order marked as ready! The cosmic kitchen has completed its work!', 'success');
      } else {
        showToast(`Order status updated to ${status}`, 'success');
      }
      
      await fetchOrders();
    } catch (error) {
      console.error('Error updating order status:', error);
      showToast('Failed to update order status. Please try again.', 'error');
    } finally {
      setUpdatingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(updateKey);
        return newSet;
      });
    }
  };

  const handleSaveMenuItem = async () => {
    if (savingMenuItem) return;

    if (!editForm.name.trim()) {
      showToast('Please enter an item name', 'error');
      return;
    }

    if (!editForm.description.trim()) {
      showToast('Please enter a description', 'error');
      return;
    }

    const price = parseFloat(editForm.price);
    if (isNaN(price) || price <= 0) {
      showToast('Please enter a valid price', 'error');
      return;
    }

    const serves = parseInt(editForm.serves);
    if (isNaN(serves) || serves <= 0) {
      showToast('Please enter a valid serves count', 'error');
      return;
    }

    const quantityAvailable = parseInt(editForm.quantity_available);
    if (isNaN(quantityAvailable) || quantityAvailable < 0) {
      showToast('Please enter a valid quantity', 'error');
      return;
    }

    setSavingMenuItem(true);

    try {
      const defaultImageUrl = 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg';
      const imageUrl = editForm.image_url.trim() || defaultImageUrl;

      const menuItemData = {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        price: price,
        image_url: imageUrl,
        category: editForm.category || 'main_course',
        serves: serves,
        canteen_name: user?.full_name || '',
        quantity_available: quantityAvailable
      };

      let result;
      if (editingItem) {
        result = await supabase
          .from('menu_items')
          .update(menuItemData)
          .eq('id', editingItem.id)
          .select();
      } else {
        result = await supabase
          .from('menu_items')
          .insert([menuItemData])
          .select();
      }

      if (result.error) {
        throw new Error(result.error.message);
      }

      showToast(
        editingItem ? 'Menu item updated successfully!' : 'Menu item created successfully!', 
        'success'
      );

      await fetchMenuItems();
      setIsEditModalOpen(false);
      setEditingItem(null);
    } catch (error) {
      console.error('Error saving menu item:', error);
      showToast('Failed to save menu item. Please try again.', 'error');
    } finally {
      setSavingMenuItem(false);
    }
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    if (deletingMenuItem === itemId) return;

    if (!confirm('Are you sure you want to delete this menu item? This action cannot be undone.')) return;
    
    setDeletingMenuItem(itemId);

    try {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
      
      showToast('Menu item deleted successfully!', 'success');
      await fetchMenuItems();
    } catch (error) {
      console.error('Error deleting menu item:', error);
      showToast('Failed to delete menu item. Please try again.', 'error');
    } finally {
      setDeletingMenuItem(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'processing': return 'status-processing';
      case 'ready': return 'status-ready';
      case 'completed': return 'status-completed';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-pending';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="w-4 h-4" />;
      case 'processing': return <Package className="w-4 h-4" />;
      case 'ready': return <CheckCircle className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'cancelled': return <AlertCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const isOrderUpdating = (orderId: string, status: string) => {
    const updateKey = `${orderId}-${status}`;
    return updatingOrders.has(updateKey);
  };

  const formatStudentInfo = (orderUser: any) => {
    if (!orderUser) {
      return 'Unknown Student (No User Data)';
    }
    
    const name = orderUser.full_name || 'Unknown Name';
    const regNumber = orderUser.registration_number;
    
    if (regNumber) {
      return `${name} (${regNumber})`;
    }
    
    return `${name} (No Reg. Number)`;
  };

  if (loading) {
    return (
      <div className="min-h-screen modern-gradient flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 modern-spinner rounded-full animate-spin mx-auto mb-6"></div>
          <div className="flex items-center justify-center space-x-3">
            <Crown className="w-6 h-6 text-emerald-500" />
            <span className="text-xl font-medium text-gray-200">Loading Command Center...</span>
          </div>
          <p className="text-gray-400 text-sm mt-2">Preparing your dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen modern-gradient">
      <Header title={`${user?.full_name || 'Staff'} Command Center`} />

      {/* Toast Notifications */}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="mb-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('orders')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'orders'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:border-gray-400'
              }`}
            >
              Orders Management
            </button>
            <button
              onClick={() => setActiveTab('menu')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'menu'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:border-gray-400'
              }`}
            >
              Menu Management
            </button>
          </nav>
        </div>

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Orders for {user?.full_name}</h2>
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                <div className="glass-morphism px-4 py-2 rounded-lg border border-white/20">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Total Orders: </span>
                  <span className="font-semibold text-gray-800 dark:text-white">{orders.length}</span>
                </div>
                <div className="glass-morphism px-4 py-2 rounded-lg border border-white/20">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Pending: </span>
                  <span className="font-semibold text-amber-400">
                    {orders.filter(o => o.status === 'pending').length}
                  </span>
                </div>
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto mb-4 border border-white/20">
                  <Clock className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">No orders yet</h3>
                <p className="text-gray-600 dark:text-gray-400">Orders for {user?.full_name} will appear here when students place them</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {orders.map((order) => (
                  <div key={order.id} className="glass-morphism-strong rounded-xl p-6">
                    <div className="flex flex-col lg:flex-row justify-between items-start mb-4 gap-4">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-800 dark:text-white">
                          Order #{order.id.slice(0, 8)}
                        </h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
                          {formatStudentInfo(order.user)}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-500">
                          {new Date(order.created_at).toLocaleDateString()} at{' '}
                          {new Date(order.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold gradient-text">₹{order.total_amount}</p>
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                          {getStatusIcon(order.status)}
                          <span className="ml-1 capitalize">{order.status}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mb-4">
                      <h5 className="font-medium text-gray-800 dark:text-white mb-2">Items from {user?.full_name}:</h5>
                      <div className="space-y-2">
                        {order.order_items.map((item) => (
                          <div key={item.id} className="flex justify-between items-center glass-morphism p-2 rounded border border-white/10">
                            <span className="text-gray-600 dark:text-gray-300">
                              {item.menu_item.name} x {item.quantity}
                            </span>
                            <span className="font-medium text-gray-800 dark:text-white">₹{item.price * item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => updateOrderStatus(order.id, 'processing')}
                        disabled={order.status !== 'pending' || isOrderUpdating(order.id, 'processing')}
                        className="px-4 py-2 modern-button text-black dark:text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm"
                      >
                        {isOrderUpdating(order.id, 'processing') ? 'Updating...' : 'Start Processing'}
                      </button>
                      <button
                        onClick={() => updateOrderStatus(order.id, 'ready')}
                        disabled={order.status !== 'processing' || isOrderUpdating(order.id, 'ready')}
                        className="px-4 py-2 text-black dark:text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm"
                        style={{ 
                          background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.9) 0%, rgba(16, 185, 129, 0.9) 100%)',
                          boxShadow: '0 0 20px rgba(34, 197, 94, 0.4)' 
                        }}
                      >
                        {isOrderUpdating(order.id, 'ready') ? 'Updating...' : 'Mark Ready'}
                      </button>
                      <button
                        onClick={() => updateOrderStatus(order.id, 'completed')}
                        disabled={order.status !== 'ready' || isOrderUpdating(order.id, 'completed')}
                        className="px-4 py-2 glass-morphism hover:bg-white/10 text-black dark:text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm border border-white/20"
                      >
                        {isOrderUpdating(order.id, 'completed') ? 'Updating...' : 'Complete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Menu Tab */}
        {activeTab === 'menu' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Menu Items for {user?.full_name}</h2>
              <button
                onClick={() => {
                  setEditingItem(null);
                  setIsEditModalOpen(true);
                }}
                className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg transition-all duration-200"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.9) 0%, rgba(5, 150, 105, 0.9) 100%)',
                  boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)' 
                }}
              >
                <Plus className="w-5 h-5" />
                <span>Add New Item</span>
              </button>
            </div>

            <div className="responsive-grid">
              {menuItems.map((item) => (
                <div key={item.id} className="glass-card rounded-xl overflow-hidden">
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-semibold text-gray-800 dark:text-white">{item.name}</h3>
                      <span className="text-xl font-bold cosmic-text">₹{item.price}</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">{item.description}</p>
                    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-500 mb-2">
                      <span>Available: {item.quantity_available}</span>
                      <span>Serves: {item.serves}</span>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      <span className="font-medium">Canteen:</span> {item.canteen_name}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setEditingItem(item);
                          setIsEditModalOpen(true);
                        }}
                        className="flex-1 flex items-center justify-center space-x-2 modern-button text-white px-4 py-2 rounded-lg transition-all duration-200"
                      >
                        <Edit className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleDeleteMenuItem(item.id)}
                        disabled={deletingMenuItem === item.id}
                        className="flex-1 flex items-center justify-center space-x-2 text-white px-4 py-2 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ 
                          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.9) 0%, rgba(220, 38, 38, 0.9) 100%)',
                          boxShadow: '0 0 20px rgba(239, 68, 68, 0.4)' 
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>{deletingMenuItem === item.id ? 'Deleting...' : 'Delete'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {menuItems.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto mb-4 border border-white/20">
                  <Plus className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">No menu items yet</h3>
                <p className="text-gray-600 dark:text-gray-400">Add your first menu item for {user?.full_name} to get started</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit/Add Menu Item Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-morphism-strong rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/20">
              <h3 className="text-xl font-semibold text-gray-800 dark:text-white">
                {editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                disabled={savingMenuItem}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Item Name *
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 glass-input rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                  placeholder="Enter item name"
                  disabled={savingMenuItem}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description *
                </label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 modern-input rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="Enter item description"
                  disabled={savingMenuItem}
                />
              </div>

              {/* Price, Serves, Quantity Available */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <DollarSign className="w-4 h-4 inline mr-1" />
                    Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.price}
                    onChange={(e) => setEditForm(prev => ({ ...prev, price: e.target.value }))}
                    className="w-full px-3 py-2 modern-input rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="0.00"
                    disabled={savingMenuItem}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <Users className="w-4 h-4 inline mr-1" />
                    Serves *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editForm.serves}
                    onChange={(e) => setEditForm(prev => ({ ...prev, serves: e.target.value }))}
                    className="w-full px-3 py-2 modern-input rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="1"
                    disabled={savingMenuItem}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <Package2 className="w-4 h-4 inline mr-1" />
                    Available Qty *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.quantity_available}
                    onChange={(e) => setEditForm(prev => ({ ...prev, quantity_available: e.target.value }))}
                    className="w-full px-3 py-2 modern-input rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="0"
                    disabled={savingMenuItem}
                  />
                </div>
              </div>

              {/* Category and Canteen */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Category
                  </label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-3 py-2 modern-input rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    disabled={savingMenuItem}
                  >
                    <option value="main_course" className="bg-black text-white">Main Course</option>
                    <option value="snacks" className="bg-black text-white">Snacks</option>
                    <option value="beverages" className="bg-black text-white">Beverages</option>
                    <option value="south_indian" className="bg-black text-white">South Indian</option>
                    <option value="desserts" className="bg-black text-white">Desserts</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Canteen Name
                  </label>
                  <input
                    type="text"
                    value={user?.full_name || ''}
                    className="w-full px-3 py-2 glass-input rounded-lg bg-white/5 text-gray-400"
                    disabled
                    readOnly
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-500 mt-1">
                    Items will be added to your canteen automatically
                  </p>
                </div>
              </div>

              {/* Image URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Image URL (Optional)
                </label>
                <input
                  type="text"
                  value={editForm.image_url}
                  onChange={(e) => setEditForm(prev => ({ ...prev, image_url: e.target.value }))}
                  className="w-full px-3 py-2 modern-input rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="https://example.com/image.jpg"
                  disabled={savingMenuItem}
                />
                <p className="text-xs text-gray-600 dark:text-gray-500 mt-1">
                  Leave empty to use default image
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex space-x-4 p-6 border-t border-white/20">
              <button
                onClick={() => setIsEditModalOpen(false)}
                disabled={savingMenuItem}
                className="flex-1 px-4 py-2 glass-morphism border border-white/20 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-gray-800 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMenuItem}
                disabled={savingMenuItem}
                className="flex-1 px-4 py-2 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.9) 0%, rgba(5, 150, 105, 0.9) 100%)',
                  boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)' 
                }}
              >
                <Shield className="w-4 h-4" />
                <span>{savingMenuItem ? 'Saving...' : editingItem ? 'Update Item' : 'Create Item'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffDashboard;