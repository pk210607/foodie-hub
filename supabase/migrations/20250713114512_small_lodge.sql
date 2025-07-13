/*
  # Fix Quantity Management System

  1. Database Functions
    - Create proper functions for cart operations with quantity management
    - Ensure atomic operations for cart and menu item updates
    - Add proper error handling and validation

  2. Security
    - Update RLS policies to allow quantity updates
    - Ensure staff can update menu items
    - Allow cart operations for authenticated users

  3. Real-time Updates
    - Enable real-time subscriptions for menu_items table
    - Ensure immediate reflection of quantity changes
*/

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS add_to_cart_with_quantity_update(uuid, uuid, integer);
DROP FUNCTION IF EXISTS remove_from_cart_with_quantity_restore(uuid);
DROP FUNCTION IF EXISTS update_cart_quantity_with_menu_sync(uuid, integer);

-- Function to add item to cart and update menu quantity
CREATE OR REPLACE FUNCTION add_to_cart_with_quantity_update(
  p_user_id uuid,
  p_menu_item_id uuid,
  p_quantity integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_quantity integer;
  v_cart_item_id uuid;
  v_existing_cart_quantity integer := 0;
BEGIN
  -- Check if menu item exists and get current quantity
  SELECT quantity_available INTO v_current_quantity
  FROM menu_items
  WHERE id = p_menu_item_id;
  
  IF v_current_quantity IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Menu item not found');
  END IF;
  
  -- Check if there's enough quantity available
  IF v_current_quantity < p_quantity THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient quantity available');
  END IF;
  
  -- Check if item already exists in cart
  SELECT id, quantity INTO v_cart_item_id, v_existing_cart_quantity
  FROM cart_items
  WHERE user_id = p_user_id AND menu_item_id = p_menu_item_id;
  
  -- Start transaction
  BEGIN
    IF v_cart_item_id IS NOT NULL THEN
      -- Update existing cart item
      UPDATE cart_items
      SET quantity = v_existing_cart_quantity + p_quantity
      WHERE id = v_cart_item_id;
    ELSE
      -- Insert new cart item
      INSERT INTO cart_items (user_id, menu_item_id, quantity)
      VALUES (p_user_id, p_menu_item_id, p_quantity);
    END IF;
    
    -- Update menu item quantity
    UPDATE menu_items
    SET quantity_available = quantity_available - p_quantity
    WHERE id = p_menu_item_id;
    
    RETURN json_build_object('success', true, 'message', 'Item added to cart successfully');
    
  EXCEPTION WHEN OTHERS THEN
    -- Rollback will happen automatically
    RETURN json_build_object('success', false, 'error', 'Failed to add item to cart: ' || SQLERRM);
  END;
END;
$$;

-- Function to remove item from cart and restore menu quantity
CREATE OR REPLACE FUNCTION remove_from_cart_with_quantity_restore(
  p_cart_item_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_menu_item_id uuid;
  v_quantity integer;
BEGIN
  -- Get cart item details
  SELECT menu_item_id, quantity INTO v_menu_item_id, v_quantity
  FROM cart_items
  WHERE id = p_cart_item_id;
  
  IF v_menu_item_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Cart item not found');
  END IF;
  
  -- Start transaction
  BEGIN
    -- Remove cart item
    DELETE FROM cart_items WHERE id = p_cart_item_id;
    
    -- Restore menu item quantity
    UPDATE menu_items
    SET quantity_available = quantity_available + v_quantity
    WHERE id = v_menu_item_id;
    
    RETURN json_build_object('success', true, 'message', 'Item removed from cart successfully');
    
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Failed to remove item from cart: ' || SQLERRM);
  END;
END;
$$;

-- Function to update cart quantity and sync menu quantity
CREATE OR REPLACE FUNCTION update_cart_quantity_with_menu_sync(
  p_cart_item_id uuid,
  p_new_quantity integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_menu_item_id uuid;
  v_old_quantity integer;
  v_quantity_diff integer;
  v_current_menu_quantity integer;
BEGIN
  -- Get cart item details
  SELECT menu_item_id, quantity INTO v_menu_item_id, v_old_quantity
  FROM cart_items
  WHERE id = p_cart_item_id;
  
  IF v_menu_item_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Cart item not found');
  END IF;
  
  -- Calculate quantity difference
  v_quantity_diff := p_new_quantity - v_old_quantity;
  
  -- If decreasing quantity (removing items), no need to check availability
  IF v_quantity_diff > 0 THEN
    -- Check if enough quantity is available
    SELECT quantity_available INTO v_current_menu_quantity
    FROM menu_items
    WHERE id = v_menu_item_id;
    
    IF v_current_menu_quantity < v_quantity_diff THEN
      RETURN json_build_object('success', false, 'error', 'Insufficient quantity available');
    END IF;
  END IF;
  
  -- Handle quantity of 0 or less (remove item)
  IF p_new_quantity <= 0 THEN
    RETURN remove_from_cart_with_quantity_restore(p_cart_item_id);
  END IF;
  
  -- Start transaction
  BEGIN
    -- Update cart item quantity
    UPDATE cart_items
    SET quantity = p_new_quantity
    WHERE id = p_cart_item_id;
    
    -- Update menu item quantity (subtract the difference)
    UPDATE menu_items
    SET quantity_available = quantity_available - v_quantity_diff
    WHERE id = v_menu_item_id;
    
    RETURN json_build_object('success', true, 'message', 'Cart quantity updated successfully');
    
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', 'Failed to update cart quantity: ' || SQLERRM);
  END;
END;
$$;

-- Update RLS policies to allow quantity updates
DROP POLICY IF EXISTS "Allow quantity updates for cart operations" ON menu_items;
CREATE POLICY "Allow quantity updates for cart operations"
  ON menu_items
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (quantity_available >= 0);

-- Ensure the menu_items table allows updates for authenticated users
DROP POLICY IF EXISTS "Staff can manage menu items" ON menu_items;
CREATE POLICY "Staff can manage menu items"
  ON menu_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'staff'
    )
  );

-- Allow authenticated users to read menu items
DROP POLICY IF EXISTS "Anyone can read menu items" ON menu_items;
CREATE POLICY "Anyone can read menu items"
  ON menu_items
  FOR SELECT
  TO authenticated
  USING (true);

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION add_to_cart_with_quantity_update(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_from_cart_with_quantity_restore(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_cart_quantity_with_menu_sync(uuid, integer) TO authenticated;

-- Enable real-time for menu_items table
ALTER PUBLICATION supabase_realtime ADD TABLE menu_items;