/** prisma/schema.prisma의 VarChar와 1:1 — 판매자·관리자가 같은 값을 쓰므로 스키마가 바뀌면 여기만 고친다. */
export const MAX_STORE_NAME_LENGTH = 200;
export const MAX_STORE_PHONE_LENGTH = 30;
export const MAX_ADDRESS_FULL_LENGTH = 500;
export const MAX_ADDRESS_CITY_LENGTH = 50;
export const MAX_ADDRESS_DISTRICT_LENGTH = 80;
export const MAX_ADDRESS_NEIGHBORHOOD_LENGTH = 80;
export const MAX_BUSINESS_HOURS_TEXT_LENGTH = 500;
export const MAX_BUSINESS_NAME_LENGTH = 200;
export const MAX_BUSINESS_PHONE_LENGTH = 30;
export const MAX_STORE_URL_LENGTH = 2048;
export const MAX_GREETING_MESSAGE_LENGTH = 500;
