import type {
  CustomTextAlign,
  PrismaClient,
  ProductCustomTemplate,
  ProductCustomTextToken,
} from '@/generated/prisma/client';
import { nextSeq } from '@/test/factories/sequence';

export interface CustomTemplateOverrides {
  product_id: bigint;
  base_image_url?: string;
  free_edit_enabled?: boolean;
  revision?: number;
  deleted_at?: Date | null;
}

export async function createCustomTemplate(
  prisma: PrismaClient,
  overrides: CustomTemplateOverrides,
): Promise<ProductCustomTemplate> {
  return prisma.productCustomTemplate.create({
    data: {
      base_image_url: 'https://i.example/base.png',
      ...overrides,
    },
  });
}

export interface CustomTextTokenOverrides {
  template_id: bigint;
  token_key?: string;
  label?: string;
  default_text?: string;
  max_length?: number;
  sort_order?: number;
  is_required?: boolean;
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number;
  text_color?: string;
  text_align?: CustomTextAlign;
  deleted_at?: Date | null;
}

export async function createCustomTextToken(
  prisma: PrismaClient,
  overrides: CustomTextTokenOverrides,
): Promise<ProductCustomTextToken> {
  const tokenKey = overrides.token_key ?? `slot${nextSeq()}`;
  return prisma.productCustomTextToken.create({
    data: {
      token_key: tokenKey,
      label: tokenKey,
      default_text: '문구',
      pos_x: 1000,
      pos_y: 1000,
      width: 8000,
      height: 1500,
      ...overrides,
    },
  });
}
