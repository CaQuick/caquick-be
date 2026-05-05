/**
 * 시드 데이터 정리(idempotent) 헬퍼.
 *
 * 시드는 다음 식별자들로만 자기 영역을 구분한다:
 *   - 유저 이메일: SEED_USER_EMAIL_PREFIX (`seed-user-`)
 *   - 매장 이름:    SEED_STORE_NAME_PREFIX (`[SEED] `)
 *
 * 정리 시 위 prefix에 매칭되는 row와 그 종속 데이터(주문/리뷰/찜/...)를
 * 삭제한 뒤 다시 삽입하므로, 수동으로 만든 다른 데이터는 보존된다.
 */
import type { PrismaClient } from '@prisma/client';

export const SEED_USER_EMAIL_PREFIX = 'seed-user-';
export const SEED_STORE_NAME_PREFIX = '[SEED] ';

export async function resetSeedScope(prisma: PrismaClient): Promise<void> {
  const seedUsers = await prisma.account.findMany({
    where: { email: { startsWith: SEED_USER_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = seedUsers.map((u) => u.id);

  const seedStores = await prisma.store.findMany({
    where: { store_name: { startsWith: SEED_STORE_NAME_PREFIX } },
    select: { id: true, seller_account_id: true },
  });
  const storeIds = seedStores.map((s) => s.id);
  const sellerAccountIds = seedStores.map((s) => s.seller_account_id);

  // 1) 유저 종속 (주문, 리뷰, 찜, 최근본, 알림, 드래프트, 검색기록, 카트, 인증세션)
  if (userIds.length > 0) {
    // 주문 종속들 → 주문 본체 (FK depth가 깊으므로 안에서 다시 처리)
    const userOrders = await prisma.order.findMany({
      where: { account_id: { in: userIds } },
      select: { id: true },
    });
    const orderIds = userOrders.map((o) => o.id);
    if (orderIds.length > 0) {
      const orderItems = await prisma.orderItem.findMany({
        where: { order_id: { in: orderIds } },
        select: { id: true },
      });
      const orderItemIds = orderItems.map((i) => i.id);
      if (orderItemIds.length > 0) {
        // OrderItemCustomFreeEdit -> attachments -> deletes
        const freeEdits = await prisma.orderItemCustomFreeEdit.findMany({
          where: { order_item_id: { in: orderItemIds } },
          select: { id: true },
        });
        const freeEditIds = freeEdits.map((f) => f.id);
        if (freeEditIds.length > 0) {
          await prisma.orderItemCustomFreeEditAttachment.deleteMany({
            where: { free_edit_id: { in: freeEditIds } },
          });
        }
        await prisma.orderItemCustomFreeEdit.deleteMany({
          where: { order_item_id: { in: orderItemIds } },
        });
        await prisma.orderItemCustomText.deleteMany({
          where: { order_item_id: { in: orderItemIds } },
        });
        await prisma.orderItemOptionItem.deleteMany({
          where: { order_item_id: { in: orderItemIds } },
        });
        // 리뷰 (OrderItem fk + Review fk)
        await prisma.reviewLike.deleteMany({
          where: { review: { order_item_id: { in: orderItemIds } } },
        });
        await prisma.reviewMedia.deleteMany({
          where: { review: { order_item_id: { in: orderItemIds } } },
        });
        await prisma.review.deleteMany({
          where: { order_item_id: { in: orderItemIds } },
        });
      }
      await prisma.orderItem.deleteMany({
        where: { order_id: { in: orderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { order_id: { in: orderIds } },
      });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }

    // 리뷰: 주문 종속에서 이미 처리되었지만, 다른 리뷰가 있을 수 있음 → 사용자 기준으로도 한 번 더
    await prisma.reviewLike.deleteMany({
      where: { account_id: { in: userIds } },
    });
    await prisma.reviewMedia.deleteMany({
      where: { review: { account_id: { in: userIds } } },
    });
    await prisma.review.deleteMany({ where: { account_id: { in: userIds } } });

    // 찜
    await prisma.wishlistItem.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 최근 본
    await prisma.recentProductView.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 알림
    await prisma.notification.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 커스텀 드래프트
    await prisma.customDraft.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 검색 히스토리
    await prisma.searchHistory.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 카트
    const userCarts = await prisma.cart.findMany({
      where: { account_id: { in: userIds } },
      select: { id: true },
    });
    const cartIds = userCarts.map((c) => c.id);
    if (cartIds.length > 0) {
      const cartItems = await prisma.cartItem.findMany({
        where: { cart_id: { in: cartIds } },
        select: { id: true },
      });
      const cartItemIds = cartItems.map((i) => i.id);
      if (cartItemIds.length > 0) {
        await prisma.cartItemOptionItem.deleteMany({
          where: { cart_item_id: { in: cartItemIds } },
        });
      }
      await prisma.cartItem.deleteMany({ where: { cart_id: { in: cartIds } } });
      await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
    }

    // 인증 세션
    await prisma.authRefreshSession.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 계정 ID 연결 해제
    await prisma.accountIdentity.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 프로필
    await prisma.userProfile.deleteMany({
      where: { account_id: { in: userIds } },
    });

    // 계정 본체
    await prisma.account.deleteMany({ where: { id: { in: userIds } } });
  }

  // 2) 매장 종속 (상품, 영업시간 등)
  if (storeIds.length > 0) {
    const storeProducts = await prisma.product.findMany({
      where: { store_id: { in: storeIds } },
      select: { id: true },
    });
    const productIds = storeProducts.map((p) => p.id);
    if (productIds.length > 0) {
      // 옵션
      const optionGroups = await prisma.productOptionGroup.findMany({
        where: { product_id: { in: productIds } },
        select: { id: true },
      });
      const optionGroupIds = optionGroups.map((g) => g.id);
      if (optionGroupIds.length > 0) {
        await prisma.productOptionItem.deleteMany({
          where: { option_group_id: { in: optionGroupIds } },
        });
      }
      await prisma.productOptionGroup.deleteMany({
        where: { product_id: { in: productIds } },
      });

      // 커스텀 템플릿
      const templates = await prisma.productCustomTemplate.findMany({
        where: { product_id: { in: productIds } },
        select: { id: true },
      });
      const templateIds = templates.map((t) => t.id);
      if (templateIds.length > 0) {
        await prisma.productCustomTextToken.deleteMany({
          where: { template_id: { in: templateIds } },
        });
      }
      await prisma.productCustomTemplate.deleteMany({
        where: { product_id: { in: productIds } },
      });

      await prisma.productImage.deleteMany({
        where: { product_id: { in: productIds } },
      });
      await prisma.productCategory.deleteMany({
        where: { product_id: { in: productIds } },
      });
      await prisma.productTag.deleteMany({
        where: { product_id: { in: productIds } },
      });

      // 다른 사용자의 cartItem/wishlist/recentView/customDraft에 이 product가 참조될 수 있음
      // 시드 store의 product를 안전하게 지우려면 외부 참조도 같이 정리
      const sharedItems = await prisma.cartItem.findMany({
        where: { product_id: { in: productIds } },
        select: { id: true },
      });
      const sharedItemIds = sharedItems.map((i) => i.id);
      if (sharedItemIds.length > 0) {
        await prisma.cartItemOptionItem.deleteMany({
          where: { cart_item_id: { in: sharedItemIds } },
        });
      }
      await prisma.cartItem.deleteMany({
        where: { product_id: { in: productIds } },
      });
      await prisma.wishlistItem.deleteMany({
        where: { product_id: { in: productIds } },
      });
      await prisma.recentProductView.deleteMany({
        where: { product_id: { in: productIds } },
      });
      await prisma.customDraft.deleteMany({
        where: { product_id: { in: productIds } },
      });

      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    }

    await prisma.storeBusinessHour.deleteMany({
      where: { store_id: { in: storeIds } },
    });
    await prisma.storeSpecialClosure.deleteMany({
      where: { store_id: { in: storeIds } },
    });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }

  // 3) 매장의 seller account 본체
  if (sellerAccountIds.length > 0) {
    await prisma.sellerCredential.deleteMany({
      where: { seller_account_id: { in: sellerAccountIds } },
    });
    await prisma.sellerProfile.deleteMany({
      where: { account_id: { in: sellerAccountIds } },
    });
    await prisma.accountIdentity.deleteMany({
      where: { account_id: { in: sellerAccountIds } },
    });
    await prisma.authRefreshSession.deleteMany({
      where: { account_id: { in: sellerAccountIds } },
    });
    await prisma.account.deleteMany({
      where: { id: { in: sellerAccountIds } },
    });
  }
}
