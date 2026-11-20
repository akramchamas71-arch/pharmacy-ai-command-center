"use client";

/**
 * /dashboard/products — product catalog management. Requires PERMISSION_KEYS.PRODUCTS_MANAGE;
 * the sidebar already hides the nav link for roles without it, but this page still checks
 * defensively in case it's reached directly by URL.
 *
 * NOTE: never import anything from "@prisma/client" here — see ../branches/page.tsx's note
 * for why (this sandbox's local generated Prisma client is a known-broken stub). ProductType
 * is a plain string-literal union in ../../components/products/types.ts instead.
 */

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  Card,
  CardBody,
  Button,
  Badge,
  Input,
  FullPageSpinner,
  EmptyState,
  Alert,
  Spinner,
} from "@/components/ui";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import type { Product } from "@/components/products/types";
import { productTypeLabel } from "@/components/products/types";

export default function ProductsPage() {
  const canManage = useHasPermission(PERMISSION_KEYS.PRODUCTS_MANAGE);

  const [products, setProducts] = useState<Product[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstLoadRef = useRef(true);

  async function load(q: string) {
    if (firstLoadRef.current) setLoading(true);
    else setSearching(true);
    setLoadError(null);
    try {
      const url = q.trim() ? `/api/products?q=${encodeURIComponent(q.trim())}&limit=200` : `/api/products?limit=200`;
      const data = await api.get<{ products: Product[] }>(url);
      setProducts(data.products);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل المنتجات");
    } finally {
      setLoading(false);
      setSearching(false);
      firstLoadRef.current = false;
    }
  }

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  useEffect(() => {
    if (!canManage || firstLoadRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, canManage]);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="المنتجات" />
        <Card>
          <CardBody>
            <EmptyState
              title="لا تملك صلاحية الوصول لهذه الصفحة"
              description="إدارة المنتجات تتطلب صلاحية خاصة غير متوفرة لحسابك الحالي."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (loading) return <FullPageSpinner label="جارِ تحميل المنتجات..." />;

  function openCreate() {
    setEditingProduct(null);
    setActionError(null);
    setModalOpen(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setActionError(null);
    setModalOpen(true);
  }

  function handleSaved(product: Product) {
    setProducts((prev) => {
      if (!prev) return [product];
      const exists = prev.some((p) => p.id === product.id);
      return exists ? prev.map((p) => (p.id === product.id ? product : p)) : [product, ...prev];
    });
  }

  async function handleDelete(product: Product) {
    if (!window.confirm(`هل أنت متأكد من حذف منتج "${product.name}" بشكل نهائي؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }
    setActionError(null);
    setBusyId(product.id);
    try {
      await api.delete(`/api/products/${product.id}`);
      setProducts((prev) => (prev ? prev.filter((p) => p.id !== product.id) : prev));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "تعذّر حذف المنتج");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="المنتجات"
        description="إدارة الكتالوج العام للمنتجات — الإضافة، التعديل، والحذف."
        action={<Button onClick={openCreate}>+ منتج جديد</Button>}
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالاسم، الماركة، الباركود، الاسم العلمي، أو المادة الفعالة..."
          />
        </div>
        {searching && <Spinner className="h-4 w-4 text-brand-500" />}
      </div>

      {loadError && (
        <div className="mb-4">
          <Alert tone="danger">{loadError}</Alert>
        </div>
      )}
      {actionError && (
        <div className="mb-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}

      <Card>
        {!products || products.length === 0 ? (
          <CardBody>
            <EmptyState
              title={query.trim() ? "لا توجد نتائج مطابقة" : "لا توجد منتجات بعد"}
              description={query.trim() ? "جرّب كلمة بحث أخرى." : "أضف أول منتج إلى الكتالوج للبدء."}
              action={!query.trim() ? <Button onClick={openCreate}>+ منتج جديد</Button> : undefined}
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الماركة</th>
                  <th>الباركود</th>
                  <th>الاسم العلمي</th>
                  <th>النوع / الفئة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="font-medium text-slate-800">{product.name}</td>
                    <td className="text-slate-500">{product.brand || "—"}</td>
                    <td className="text-slate-500">{product.barcode || "—"}</td>
                    <td className="text-slate-500">{product.genericName || "—"}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={product.type === "CONTROLLED" ? "danger" : product.type === "PRESCRIPTION" ? "warning" : "neutral"}>
                          {productTypeLabel(product.type)}
                        </Badge>
                        {product.category && <span className="text-xs text-slate-400">{product.category}</span>}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openEdit(product)}>
                          تعديل
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={busyId === product.id}
                          onClick={() => handleDelete(product)}
                        >
                          حذف
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        product={editingProduct}
        onSaved={handleSaved}
      />
    </div>
  );
}
