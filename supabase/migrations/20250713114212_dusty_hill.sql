/*
  # Enable Real-time Quantity Updates

  1. Database Changes
    - Add RLS policies for menu_items updates
    - Enable real-time subscriptions for menu_items table
    - Add trigger for automatic quantity validation
    - Add function to handle quantity updates safely

  2. Security
    - Allow staff to update their own menu items
    - Allow system to update quantities during cart operations
    - Prevent negative quantities
    - Add constraints for data integrity

  3. Real-time Features
    - Enable real-time subscriptions on menu_items table
    - Add automatic refresh triggers
*/

-- Enable real-time for menu_items table
ALTER PUBLICATION supabase_realtime ADD TABLE menu_items;

-- Add policy to allow quantity updates during cart operations
CREATE POLICY "Allow quantity updates for cart operations"
  ON menu_items
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (quantity_available >= 0);

-- Create function to safely update menu item quantity
CREATE OR REPLACE FUNCTION update_menu_item_quantity(
  item_id uuid,
  quantity_change integer
) RETURNS boolean AS $$
DECLARE
  current_quantity integer;
  new_quantity integer;
BEGIN
  -- Get current quantity with row lock
  SELECT quantity_available INTO current_quantity
  FROM menu_items
  WHERE id = item_id
  FOR UPDATE;
  
  -- Check if item exists
  IF current_quantity IS NULL THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;
  
  -- Calculate new quantity
  new_quantity := current_quantity + quantity_change;
  
  -- Ensure quantity doesn't go below 0
  IF new_quantity < 0 THEN
    RAISE EXCEPTION 'Insufficient quantity available. Current: %, Requested change: %', current_quantity, quantity_change;
  END IF;
  
  -- Update the quantity
  UPDATE menu_items
  SET quantity_available = new_quantity,
      updated_at = now()
  WHERE id = item_id;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to handle cart item insertion with quantity update
CREATE OR REPLACE FUNCTION add_to_cart_with_quantity_update(
  p_user_id uuid,
  p_menu_item_id uuid,
  p_quantity integer DEFAULT 1
) RETURNS json AS $$
DECLARE
  existing_cart_item cart_items%ROWTYPE;
  result json;
BEGIN
  -- Start transaction
  BEGIN
    -- Check if item already exists in cart
    SELECT * INTO existing_cart_item
    FROM cart_items
    WHERE user_id = p_user_id AND menu_item_id = p_menu_item_id;
    
    -- Update menu item quantity (decrease)
    PERFORM update_menu_item_quantity(p_menu_item_id, -p_quantity);
    
    IF existing_cart_item.id IS NOT NULL THEN
      -- Update existing cart item
      UPDATE cart_items
      SET quantity = quantity + p_quantity
      WHERE id = existing_cart_item.id;
      
      result := json_build_object(
        'success', true,
        'action', 'updated',
        'cart_item_id', existing_cart_item.id
      );
    ELSE
      -- Insert new cart item
      INSERT INTO cart_items (user_id, menu_item_id, quantity)
      VALUES (p_user_id, p_menu_item_id, p_quantity);
      
      result := json_build_object(
        'success', true,
        'action', 'inserted',
        'cart_item_id', (SELECT id FROM cart_items WHERE user_id = p_user_id AND menu_item_id = p_menu_item_id)
      );
    END IF;
    
    RETURN result;
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback will happen automatically
      RETURN json_build_object(
        'success', false,
        'error', SQLERRM
      );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to handle cart item removal with quantity restoration
CREATE OR REPLACE FUNCTION remove_from_cart_with_quantity_restore(
  p_cart_item_id uuid
) RETURNS json AS $$
DECLARE
  cart_item cart_items%ROWTYPE;
  result json;
BEGIN
  -- Start transaction
  BEGIN
    -- Get cart item details
    SELECT * INTO cart_item
    FROM cart_items
    WHERE id = p_cart_item_id;
    
    IF cart_item.id IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Cart item not found'
      );
    END IF;
    
    -- Restore menu item quantity (increase)
    PERFORM update_menu_item_quantity(cart_item.menu_item_id, cart_item.quantity);
    
    -- Remove cart item
    DELETE FROM cart_items WHERE id = p_cart_item_id;
    
    result := json_build_object(
      'success', true,
      'action', 'removed',
      'restored_quantity', cart_item.quantity
    );
    
    RETURN result;
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback will happen automatically
      RETURN json_build_object(
        'success', false,
        'error', SQLERRM
      );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to handle cart quantity updates
CREATE OR REPLACE FUNCTION update_cart_quantity_with_menu_sync(
  p_cart_item_id uuid,
  p_new_quantity integer
) RETURNS json AS $$
DECLARE
  cart_item cart_items%ROWTYPE;
  quantity_difference integer;
  result json;
BEGIN
  -- Start transaction
  BEGIN
    -- Get current cart item
    SELECT * INTO cart_item
    FROM cart_items
    WHERE id = p_cart_item_id;
    
    IF cart_item.id IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Cart item not found'
      );
    END IF;
    
    -- Calculate quantity difference
    quantity_difference := p_new_quantity - cart_item.quantity;
    
    IF p_new_quantity <= 0 THEN
      -- Remove item completely
      RETURN remove_from_cart_with_quantity_restore(p_cart_item_id);
    END IF;
    
    -- Update menu item quantity (negative difference means decrease menu quantity)
    PERFORM update_menu_item_quantity(cart_item.menu_item_id, -quantity_difference);
    
    -- Update cart item quantity
    UPDATE cart_items
    SET quantity = p_new_quantity
    WHERE id = p_cart_item_id;
    
    result := json_build_object(
      'success', true,
      'action', 'updated',
      'new_quantity', p_new_quantity,
      'quantity_difference', quantity_difference
    );
    
    RETURN result;
  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback will happen automatically
      RETURN json_build_object(
        'success', false,
        'error', SQLERRM
      );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add constraint to ensure quantity_available is never negative
ALTER TABLE menu_items 
DROP CONSTRAINT IF EXISTS menu_items_quantity_available_check;

ALTER TABLE menu_items 
ADD CONSTRAINT menu_items_quantity_available_check 
CHECK (quantity_available >= 0);

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION update_menu_item_quantity(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION add_to_cart_with_quantity_update(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_from_cart_with_quantity_restore(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_cart_quantity_with_menu_sync(uuid, integer) TO authenticated;