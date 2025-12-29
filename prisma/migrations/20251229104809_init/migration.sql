-- CreateTable
CREATE TABLE `account` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_type` ENUM('USER', 'SELLER', 'ADMIN') NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
    `email` VARCHAR(320) NULL,
    `name` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `account_email_key`(`email`),
    INDEX `idx_account_type_status`(`account_type`, `status`),
    INDEX `idx_account_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_profile` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `nickname` VARCHAR(50) NOT NULL,
    `birth_date` DATE NULL,
    `phone_number` VARCHAR(30) NULL,
    `profile_image_url` VARCHAR(2048) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `user_profile_account_id_key`(`account_id`),
    INDEX `idx_user_profile_nickname`(`nickname`),
    INDEX `idx_user_profile_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_profile` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `business_name` VARCHAR(200) NOT NULL,
    `business_phone` VARCHAR(30) NOT NULL,
    `website_url` VARCHAR(2048) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `seller_profile_account_id_key`(`account_id`),
    INDEX `idx_seller_profile_business_name`(`business_name`),
    INDEX `idx_seller_profile_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_credential` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `seller_account_id` BIGINT UNSIGNED NOT NULL,
    `username` VARCHAR(80) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `password_updated_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `seller_credential_seller_account_id_key`(`seller_account_id`),
    UNIQUE INDEX `seller_credential_username_key`(`username`),
    INDEX `idx_seller_credential_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_identity` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `provider` ENUM('GOOGLE', 'KAKAO') NOT NULL,
    `provider_subject` VARCHAR(255) NOT NULL,
    `provider_email` VARCHAR(320) NULL,
    `provider_display_name` VARCHAR(200) NULL,
    `provider_profile_image_url` VARCHAR(2048) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_account_identity_account_id`(`account_id`),
    INDEX `idx_account_identity_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_account_identity_provider_sub`(`provider`, `provider_subject`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_refresh_session` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(512) NULL,
    `ip_address` VARCHAR(64) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_session_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `auth_refresh_session_token_hash_key`(`token_hash`),
    INDEX `idx_auth_refresh_session_account_id`(`account_id`),
    INDEX `idx_auth_refresh_session_expires_at`(`expires_at`),
    INDEX `idx_auth_refresh_session_revoked_at`(`revoked_at`),
    INDEX `idx_auth_refresh_session_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `seller_account_id` BIGINT UNSIGNED NOT NULL,
    `store_name` VARCHAR(200) NOT NULL,
    `store_phone` VARCHAR(30) NOT NULL,
    `address_full` VARCHAR(500) NOT NULL,
    `address_city` VARCHAR(50) NULL,
    `address_district` VARCHAR(80) NULL,
    `address_neighborhood` VARCHAR(80) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `map_provider` ENUM('NAVER', 'KAKAO', 'NONE') NOT NULL DEFAULT 'NONE',
    `business_hours_text` VARCHAR(500) NULL,
    `pickup_slot_interval_minutes` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    `min_lead_time_minutes` INTEGER UNSIGNED NOT NULL DEFAULT 180,
    `max_days_ahead` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    `website_url` VARCHAR(2048) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_seller`(`seller_account_id`),
    INDEX `idx_store_name`(`store_name`),
    INDEX `idx_store_region`(`address_city`, `address_district`, `address_neighborhood`),
    INDEX `idx_store_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_business_hour` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `day_of_week` TINYINT UNSIGNED NOT NULL,
    `is_closed` BOOLEAN NOT NULL DEFAULT false,
    `open_time` TIME(0) NULL,
    `close_time` TIME(0) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_business_hour_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_store_business_hour`(`store_id`, `day_of_week`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_special_closure` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `closure_date` DATE NOT NULL,
    `reason` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_special_closure_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_store_special_closure`(`store_id`, `closure_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `category` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `category_type` ENUM('EVENT', 'STYLE', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_category_sort`(`category_type`, `sort_order`),
    INDEX `idx_category_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_category_type_name`(`category_type`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tag` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `tag_name_key`(`name`),
    INDEX `idx_tag_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `purchase_notice` TEXT NULL,
    `regular_price` INTEGER UNSIGNED NOT NULL,
    `sale_price` INTEGER UNSIGNED NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'KRW',
    `base_design_image_url` VARCHAR(2048) NULL,
    `preparation_time_minutes` INTEGER UNSIGNED NOT NULL DEFAULT 180,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_store`(`store_id`),
    INDEX `idx_product_name`(`name`),
    INDEX `idx_product_active`(`is_active`),
    INDEX `idx_product_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_image` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_image_product`(`product_id`, `sort_order`),
    INDEX `idx_product_image_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_category` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `category_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_category_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_product_category`(`product_id`, `category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_tag` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `tag_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_tag_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_product_tag`(`product_id`, `tag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_option_group` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `min_select` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `max_select` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `option_requires_description` BOOLEAN NOT NULL DEFAULT false,
    `option_requires_image` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_option_group_product`(`product_id`, `sort_order`),
    INDEX `idx_product_option_group_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_option_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `option_group_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `image_url` VARCHAR(2048) NULL,
    `price_delta` INTEGER NOT NULL DEFAULT 0,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_option_item_group`(`option_group_id`, `sort_order`),
    INDEX `idx_product_option_item_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_custom_template` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `base_image_url` VARCHAR(2048) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `product_custom_template_product_id_key`(`product_id`),
    INDEX `idx_product_custom_template_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_custom_text_token` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `template_id` BIGINT UNSIGNED NOT NULL,
    `token_key` VARCHAR(60) NOT NULL,
    `default_text` VARCHAR(200) NOT NULL,
    `max_length` SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_required` BOOLEAN NOT NULL DEFAULT true,
    `pos_x` INTEGER NULL,
    `pos_y` INTEGER NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_product_custom_text_token_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_product_custom_text_token`(`template_id`, `token_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wishlist_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_wishlist_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_wishlist`(`account_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `cart_account_id_key`(`account_id`),
    INDEX `idx_cart_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `cart_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `quantity` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_cart_item_cart`(`cart_id`),
    INDEX `idx_cart_item_product`(`product_id`),
    INDEX `idx_cart_item_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cart_item_option_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `cart_item_id` BIGINT UNSIGNED NOT NULL,
    `option_item_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_cart_item_option_item_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_cart_item_option_item`(`cart_item_id`, `option_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_draft` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `template_id` BIGINT UNSIGNED NULL,
    `status` ENUM('IN_PROGRESS', 'READY_FOR_ORDER') NOT NULL DEFAULT 'IN_PROGRESS',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_custom_draft_account`(`account_id`),
    INDEX `idx_custom_draft_product`(`product_id`),
    INDEX `idx_custom_draft_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_draft_text_value` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `draft_id` BIGINT UNSIGNED NOT NULL,
    `token_id` BIGINT UNSIGNED NOT NULL,
    `value_text` VARCHAR(200) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_custom_draft_text_value_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_custom_draft_text_value`(`draft_id`, `token_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_draft_free_edit` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `draft_id` BIGINT UNSIGNED NOT NULL,
    `crop_image_url` VARCHAR(2048) NOT NULL,
    `description_text` VARCHAR(2000) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_custom_draft_free_edit_draft`(`draft_id`, `sort_order`),
    INDEX `idx_custom_draft_free_edit_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custom_draft_free_edit_attachment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `free_edit_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_custom_draft_free_edit_attachment`(`free_edit_id`, `sort_order`),
    INDEX `idx_custom_draft_free_edit_attachment_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_number` VARCHAR(30) NOT NULL,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('SUBMITTED', 'CONFIRMED', 'MADE', 'PICKED_UP', 'CANCELED') NOT NULL DEFAULT 'SUBMITTED',
    `pickup_at` DATETIME(3) NOT NULL,
    `buyer_name` VARCHAR(100) NOT NULL,
    `buyer_phone` VARCHAR(30) NOT NULL,
    `subtotal_price` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `discount_price` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `total_price` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `submitted_at` DATETIME(3) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `made_at` DATETIME(3) NULL,
    `picked_up_at` DATETIME(3) NULL,
    `canceled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `order_order_number_key`(`order_number`),
    INDEX `idx_order_account`(`account_id`),
    INDEX `idx_order_status`(`status`, `created_at`),
    INDEX `idx_order_pickup_at`(`pickup_at`),
    INDEX `idx_order_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_status_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `from_status` ENUM('SUBMITTED', 'CONFIRMED', 'MADE', 'PICKED_UP', 'CANCELED') NULL,
    `to_status` ENUM('SUBMITTED', 'CONFIRMED', 'MADE', 'PICKED_UP', 'CANCELED') NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_order_status_history_order`(`order_id`, `changed_at`),
    INDEX `idx_order_status_history_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `product_name_snapshot` VARCHAR(200) NOT NULL,
    `regular_price_snapshot` INTEGER UNSIGNED NOT NULL,
    `sale_price_snapshot` INTEGER UNSIGNED NULL,
    `quantity` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `item_subtotal_price` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `custom_draft_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_order_item_order`(`order_id`),
    INDEX `idx_order_item_store`(`store_id`),
    INDEX `idx_order_item_product`(`product_id`),
    INDEX `idx_order_item_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_option_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `option_group_id` BIGINT UNSIGNED NOT NULL,
    `option_item_id` BIGINT UNSIGNED NOT NULL,
    `group_name_snapshot` VARCHAR(120) NOT NULL,
    `option_title_snapshot` VARCHAR(120) NOT NULL,
    `option_price_delta_snapshot` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_order_item_option_item_order_item`(`order_item_id`),
    INDEX `idx_order_item_option_item_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_custom_text` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `token_key_snapshot` VARCHAR(60) NOT NULL,
    `default_text_snapshot` VARCHAR(200) NOT NULL,
    `value_text` VARCHAR(200) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_order_item_custom_text_order_item`(`order_item_id`, `sort_order`),
    INDEX `idx_order_item_custom_text_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_custom_free_edit` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `crop_image_url` VARCHAR(2048) NOT NULL,
    `description_text` VARCHAR(2000) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_order_item_custom_free_edit`(`order_item_id`, `sort_order`),
    INDEX `idx_order_item_custom_free_edit_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_custom_free_edit_attachment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `free_edit_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_order_item_custom_free_edit_attachment`(`free_edit_id`, `sort_order`),
    INDEX `idx_order_item_custom_free_edit_attachment_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `product_id` BIGINT UNSIGNED NOT NULL,
    `rating` DECIMAL(2, 1) NOT NULL,
    `content` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `review_order_item_id_key`(`order_item_id`),
    INDEX `idx_review_store`(`store_id`, `created_at`),
    INDEX `idx_review_product`(`product_id`, `created_at`),
    INDEX `idx_review_account`(`account_id`, `created_at`),
    INDEX `idx_review_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_image` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `review_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_review_image_review`(`review_id`, `sort_order`),
    INDEX `idx_review_image_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('ORDER', 'SYSTEM', 'MARKETING') NOT NULL DEFAULT 'SYSTEM',
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `data_json` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_notification_account`(`account_id`, `created_at`),
    INDEX `idx_notification_unread`(`account_id`, `read_at`),
    INDEX `idx_notification_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `search_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_search_history_account_last_used`(`account_id`, `last_used_at`),
    INDEX `idx_search_history_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_search_history`(`account_id`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `search_event` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `context` ENUM('GLOBAL', 'NEIGHBORHOOD', 'CATEGORY') NOT NULL DEFAULT 'GLOBAL',
    `address_city` VARCHAR(50) NULL,
    `address_district` VARCHAR(80) NULL,
    `address_neighborhood` VARCHAR(80) NULL,
    `category_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_search_event_keyword_created`(`keyword`, `created_at`),
    INDEX `idx_search_event_context_created`(`context`, `created_at`),
    INDEX `idx_search_event_region_created`(`address_city`, `address_district`, `address_neighborhood`, `created_at`),
    INDEX `idx_search_event_category_created`(`category_id`, `created_at`),
    INDEX `idx_search_event_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `banner` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `placement` ENUM('HOME_MAIN', 'HOME_SUB', 'CATEGORY', 'STORE') NOT NULL DEFAULT 'HOME_MAIN',
    `title` VARCHAR(200) NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `link_type` ENUM('NONE', 'URL', 'PRODUCT', 'STORE', 'CATEGORY') NOT NULL DEFAULT 'NONE',
    `link_url` VARCHAR(2048) NULL,
    `link_product_id` BIGINT UNSIGNED NULL,
    `link_store_id` BIGINT UNSIGNED NULL,
    `link_category_id` BIGINT UNSIGNED NULL,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_banner_placement_active`(`placement`, `is_active`, `sort_order`),
    INDEX `idx_banner_time`(`starts_at`, `ends_at`),
    INDEX `idx_banner_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_profile` ADD CONSTRAINT `user_profile_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_profile` ADD CONSTRAINT `seller_profile_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seller_credential` ADD CONSTRAINT `seller_credential_seller_account_id_fkey` FOREIGN KEY (`seller_account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_identity` ADD CONSTRAINT `account_identity_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_refresh_session` ADD CONSTRAINT `auth_refresh_session_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_refresh_session` ADD CONSTRAINT `auth_refresh_session_replaced_by_session_id_fkey` FOREIGN KEY (`replaced_by_session_id`) REFERENCES `auth_refresh_session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store` ADD CONSTRAINT `store_seller_account_id_fkey` FOREIGN KEY (`seller_account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_business_hour` ADD CONSTRAINT `store_business_hour_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_special_closure` ADD CONSTRAINT `store_special_closure_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product` ADD CONSTRAINT `product_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_image` ADD CONSTRAINT `product_image_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_category` ADD CONSTRAINT `product_category_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_category` ADD CONSTRAINT `product_category_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_tag` ADD CONSTRAINT `product_tag_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_tag` ADD CONSTRAINT `product_tag_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_option_group` ADD CONSTRAINT `product_option_group_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_option_item` ADD CONSTRAINT `product_option_item_option_group_id_fkey` FOREIGN KEY (`option_group_id`) REFERENCES `product_option_group`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_custom_template` ADD CONSTRAINT `product_custom_template_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_custom_text_token` ADD CONSTRAINT `product_custom_text_token_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `product_custom_template`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wishlist_item` ADD CONSTRAINT `wishlist_item_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wishlist_item` ADD CONSTRAINT `wishlist_item_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart` ADD CONSTRAINT `cart_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_item` ADD CONSTRAINT `cart_item_cart_id_fkey` FOREIGN KEY (`cart_id`) REFERENCES `cart`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_item` ADD CONSTRAINT `cart_item_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_item_option_item` ADD CONSTRAINT `cart_item_option_item_cart_item_id_fkey` FOREIGN KEY (`cart_item_id`) REFERENCES `cart_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cart_item_option_item` ADD CONSTRAINT `cart_item_option_item_option_item_id_fkey` FOREIGN KEY (`option_item_id`) REFERENCES `product_option_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft` ADD CONSTRAINT `custom_draft_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft` ADD CONSTRAINT `custom_draft_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft` ADD CONSTRAINT `custom_draft_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `product_custom_template`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft_text_value` ADD CONSTRAINT `custom_draft_text_value_draft_id_fkey` FOREIGN KEY (`draft_id`) REFERENCES `custom_draft`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft_text_value` ADD CONSTRAINT `custom_draft_text_value_token_id_fkey` FOREIGN KEY (`token_id`) REFERENCES `product_custom_text_token`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft_free_edit` ADD CONSTRAINT `custom_draft_free_edit_draft_id_fkey` FOREIGN KEY (`draft_id`) REFERENCES `custom_draft`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `custom_draft_free_edit_attachment` ADD CONSTRAINT `custom_draft_free_edit_attachment_free_edit_id_fkey` FOREIGN KEY (`free_edit_id`) REFERENCES `custom_draft_free_edit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order` ADD CONSTRAINT `order_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item` ADD CONSTRAINT `order_item_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item` ADD CONSTRAINT `order_item_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item` ADD CONSTRAINT `order_item_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item` ADD CONSTRAINT `order_item_custom_draft_id_fkey` FOREIGN KEY (`custom_draft_id`) REFERENCES `custom_draft`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_option_item` ADD CONSTRAINT `order_item_option_item_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_option_item` ADD CONSTRAINT `order_item_option_item_option_group_id_fkey` FOREIGN KEY (`option_group_id`) REFERENCES `product_option_group`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_option_item` ADD CONSTRAINT `order_item_option_item_option_item_id_fkey` FOREIGN KEY (`option_item_id`) REFERENCES `product_option_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_custom_text` ADD CONSTRAINT `order_item_custom_text_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_custom_free_edit` ADD CONSTRAINT `order_item_custom_free_edit_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_custom_free_edit_attachment` ADD CONSTRAINT `order_item_custom_free_edit_attachment_free_edit_id_fkey` FOREIGN KEY (`free_edit_id`) REFERENCES `order_item_custom_free_edit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review` ADD CONSTRAINT `review_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review` ADD CONSTRAINT `review_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review` ADD CONSTRAINT `review_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review` ADD CONSTRAINT `review_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_image` ADD CONSTRAINT `review_image_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `review`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `search_history` ADD CONSTRAINT `search_history_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `search_event` ADD CONSTRAINT `search_event_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `search_event` ADD CONSTRAINT `search_event_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `banner` ADD CONSTRAINT `banner_link_product_id_fkey` FOREIGN KEY (`link_product_id`) REFERENCES `product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `banner` ADD CONSTRAINT `banner_link_store_id_fkey` FOREIGN KEY (`link_store_id`) REFERENCES `store`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `banner` ADD CONSTRAINT `banner_link_category_id_fkey` FOREIGN KEY (`link_category_id`) REFERENCES `category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
