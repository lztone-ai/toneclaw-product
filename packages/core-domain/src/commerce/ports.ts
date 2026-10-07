/** Repository ports for commerce operations; infrastructure packages implement these. */
import type {
  Fulfillment, Order, OrderItem, PaymentSession, ProcurementOrder,
} from './objects.ts'

export interface OrderRepository {
  insert(order: Order): Promise<void>
  findById(businessAccountId: string, id: string): Promise<Order | undefined>
  findByExternalId(businessAccountId: string, platform: Order['platform'], externalOrderId: string): Promise<Order | undefined>
  list(businessAccountId: string): Promise<Order[]>
  update(order: Order): Promise<void>
}

export interface OrderItemRepository {
  insertMany(items: OrderItem[]): Promise<void>
  listByOrder(businessAccountId: string, orderId: string): Promise<OrderItem[]>
}

export interface FulfillmentRepository {
  insert(fulfillment: Fulfillment): Promise<void>
  findById(businessAccountId: string, id: string): Promise<Fulfillment | undefined>
  list(businessAccountId: string): Promise<Fulfillment[]>
  listByOrder(businessAccountId: string, orderId: string): Promise<Fulfillment[]>
  update(fulfillment: Fulfillment): Promise<void>
}

export interface ProcurementOrderRepository {
  insert(order: ProcurementOrder): Promise<void>
  findById(businessAccountId: string, id: string): Promise<ProcurementOrder | undefined>
  list(businessAccountId: string): Promise<ProcurementOrder[]>
  update(order: ProcurementOrder): Promise<void>
}

export interface PaymentSessionRepository {
  insert(session: PaymentSession): Promise<void>
  findById(businessAccountId: string, id: string): Promise<PaymentSession | undefined>
  listByProcurementOrder(businessAccountId: string, procurementOrderId: string): Promise<PaymentSession[]>
  update(session: PaymentSession): Promise<void>
}

export interface CommerceRepositories {
  orders: OrderRepository
  orderItems: OrderItemRepository
  fulfillments: FulfillmentRepository
  procurementOrders: ProcurementOrderRepository
  paymentSessions: PaymentSessionRepository
}
