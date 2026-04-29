import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Building2, MapPin, AlertCircle, Image, Package, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function FactoryReviewDetail() {
  const { user, loading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const factoryId = parseInt(new URLSearchParams(window.location.search).get("id") || "0");
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = !authLoading && user?.role === "admin";
  const { data: factory, isLoading: factoryLoading } = trpc.admin.getFactoryDetail.useQuery(
    { id: factoryId },
    { enabled: isAdmin && !!factoryId }
  );
  const { data: photos } = trpc.factory.getPhotos.useQuery(
    { factoryId },
    { enabled: isAdmin && !!factoryId }
  );
  const { data: products } = trpc.product.getByFactory.useQuery(
    { factoryId },
    { enabled: isAdmin && !!factoryId }
  );
  const approveMutation = trpc.admin.approveFactory.useMutation();
  const rejectMutation = trpc.admin.rejectFactory.useMutation();

  if (authLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">您沒有權限存取此頁面</div>
      </div>
    );
  }

  if (factoryLoading) return <div className="flex items-center justify-center min-h-screen">載入中...</div>;
  if (!factory) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">找不到該工廠</div>
      </div>
    );
  }

  const handleApprove = async () => {
    try {
      setIsSubmitting(true);
      await approveMutation.mutateAsync({ factoryId });
      toast.success("已批准該工廠");
      window.location.href = "/admin";
    } catch (error) {
      toast.error("批准失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("請填寫拒絕原因");
      return;
    }
    try {
      setIsSubmitting(true);
      await rejectMutation.mutateAsync({ factoryId, reason: rejectionReason });
      toast.success("已拒絕該工廠");
      window.location.href = "/admin";
    } catch (error) {
      toast.error("拒絕失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.href = "/admin"}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">工廠審核詳情</h1>
        </div>

        <Tabs defaultValue="basic">
          <TabsList className="mb-4">
            <TabsTrigger value="basic" className="gap-2">
              <Building2 className="h-4 w-4" />基本資料
            </TabsTrigger>
            <TabsTrigger value="photos" className="gap-2">
              <Image className="h-4 w-4" />照片集
              {photos && photos.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{photos.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-2">
              <Package className="h-4 w-4" />產品
              {products && products.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{products.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* 基本資訊 */}
          <TabsContent value="basic">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {factory.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {((factory as any).ownerAccountName || (factory as any).ownerAccountEmail) && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-sm text-blue-800">
                    <User className="h-4 w-4 shrink-0" />
                    <span className="font-medium">申請帳號：</span>
                    <span>{(factory as any).ownerAccountName ?? ""}{(factory as any).ownerAccountEmail ? ` (${(factory as any).ownerAccountEmail})` : ""}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-600">產業分類</Label>
                    <p className="font-medium">{((factory as any).industry as string[] | null)?.join("、") ?? ""}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">地區</Label>
                    <p className="font-medium flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {factory.region}
                    </p>
                  </div>
                  <div>
                    <Label className="text-gray-600">公廠地址</Label>
                    <p className="font-medium">{factory.address || "未提供"}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">資本額</Label>
                    <p className="font-medium">{factory.capitalLevel}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">成立年份</Label>
                    <p className="font-medium">{factory.foundedYear}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">聯絡人</Label>
                    <p className="font-medium">{factory.ownerName}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">電話</Label>
                    <p className="font-medium">{factory.phone}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">電郵</Label>
                    <p className="font-medium">{factory.contactEmail}</p>
                  </div>
                  <div>
                    <Label className="text-gray-600">網站</Label>
                    <p className="font-medium">{factory.website || "未提供"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-gray-600">簡介</Label>
                  <p className="font-medium whitespace-pre-wrap">{factory.description}</p>
                </div>
                <div>
                  <Label className="text-gray-600">代工模式</Label>
                  <p className="font-medium">{factory.mfgModes?.join(", ") || "未提供"}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 照片集 */}
          <TabsContent value="photos">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="h-5 w-5" />照片集
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!photos || photos.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">尚未上傳任何照片</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {photos.map((photo) => (
                      <div key={photo.id} className="space-y-1">
                        <img
                          src={photo.url}
                          alt={photo.caption ?? ""}
                          className="w-full h-40 object-cover rounded-md border"
                        />
                        {photo.caption && (
                          <p className="text-xs text-muted-foreground truncate">{photo.caption}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 產品 */}
          <TabsContent value="products">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />產品列表
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!products || products.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">尚未新增任何產品</p>
                ) : (
                  <div className="space-y-3">
                    {products.map((product) => (
                      <div key={product.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{product.name}</p>
                            {product.description && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {product.priceType === "fixed" && product.priceMin && (
                              <p className="text-sm font-medium">NT$ {Number(product.priceMin).toLocaleString()}</p>
                            )}
                            {product.priceType === "range" && product.priceMin && product.priceMax && (
                              <p className="text-sm font-medium">NT$ {Number(product.priceMin).toLocaleString()} – {Number(product.priceMax).toLocaleString()}</p>
                            )}
                            {product.priceType === "market" && (
                              <p className="text-sm text-muted-foreground">市價</p>
                            )}
                          </div>
                        </div>
                        {(product.images as string[] | null)?.length ? (
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {(product.images as string[]).slice(0, 4).map((url, i) => (
                              <img key={i} src={url} alt="" className="w-16 h-16 object-cover rounded border" />
                            ))}
                          </div>
                        ) : null}
                        <div className="flex gap-2 mt-2">
                          {product.acceptSmallOrder && <Badge variant="outline" className="text-xs">接小單</Badge>}
                          {product.provideSample && <Badge variant="outline" className="text-xs">提供樣品</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 審核操作 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              審核決定
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="reason">拒絕原因（如選擇拒絕）</Label>
              <Textarea
                id="reason"
                placeholder="請填寫拒絕該工廠的原因..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
                className="mt-2"
              />
            </div>
            <div className="flex gap-4 justify-end">
              <Button variant="destructive" onClick={handleReject} disabled={isSubmitting}>拒絕</Button>
              <Button onClick={handleApprove} disabled={isSubmitting}>批准</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
