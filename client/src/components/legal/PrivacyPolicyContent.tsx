// 隱私權政策正文——從 client/src/pages/PrivacyPolicyPage.tsx 抽出的純內容
// 元件，供 PrivacyPolicyPage.tsx（/privacy 頁面）與 ConsentGate.tsx（註冊
// 條款同意流程）共用同一份文字，避免同一份政策出現兩套內容。
//
// 內容依「OXM 第 1 項第四階段」的實際資料處理 Audit 結果補強（見對話中對
// 顧問／企業服務、OXM AI 摘要與刪除機制、Cookie、第三方服務、帳號刪除機制
// 等六大項的唯讀查證）——只描述目前程式真的存在的功能與資料處理方式，沒有
// 沿用一般網站隱私權政策模板照抄。專案目前無法從 repository 確認 OXM 的正
// 式公司／商號名稱、統一編號、地址或負責人，因此全篇一律稱「OXM 平台」，
// 不自行杜撰這些資訊；聯絡方式只使用已確認存在的客服 Email 與 LINE 官方
// 帳號連結。
//
// 本檔案刻意自成一份完整、獨立的內容元件（跟 TermsContent.tsx 一樣，各自
// 定義自己的 Section／Items 排版小元件），不依賴任何共用排版元件檔——這一
// 輪的修改範圍限定只改這一個檔案，不新增其他共用檔案。

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="scroll-mt-24">
      <h2 className="text-lg font-semibold mb-3 text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed text-sm">{children}</div>
    </section>
  );
}

function Items({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 list-decimal list-inside pl-1">
      {items.map((item, i) => <li key={i} className="leading-relaxed">{item}</li>)}
    </ol>
  );
}

function BulletItems({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 list-disc list-inside pl-1">
      {items.map((item, i) => <li key={i} className="leading-relaxed">{item}</li>)}
    </ul>
  );
}

function SubHeading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-1">
      <p className="font-medium text-foreground mb-1.5">{title}</p>
      {children}
    </div>
  );
}

export function PrivacyPolicyContent() {
  return (
    <div className="max-w-[800px] mx-auto">
      <h1 className="text-3xl font-bold mb-2">隱私權政策</h1>
      <p className="text-sm text-muted-foreground mb-6">版本／最後更新日期：2026-08-21</p>

      <p className="text-muted-foreground leading-relaxed mb-4 text-sm">
        歡迎您使用 OXM 平台（以下簡稱「本平台」或「OXM」）。我們重視您的個人資料與隱私權，本政策說明 OXM 平台如何蒐集、使用、儲存及保護您的個人資料，並說明您依法可行使的權利。
      </p>
      <p className="text-muted-foreground leading-relaxed mb-8 text-sm">
        本政策只描述 OXM 平台目前實際提供之功能與資料處理方式；若您對本政策內容有任何疑問，可透過本文末所列客服管道與我們聯繫。
      </p>

      <div className="space-y-8">

        <Section title="一、政策適用範圍">
          <p>本政策適用於您使用 OXM 平台所提供之各項服務，包括但不限於：</p>
          <BulletItems items={[
            "OXM 網站與（如現行提供）行動應用程式（App）",
            "會員帳號註冊、登入與管理",
            "工廠／商家資料建立、刊登、審核與管理",
            "工廠搜尋、產業分類與媒合功能",
            "詢價、站內訊息與聯繫功能",
            "顧問／企業服務之申請、分派與案件管理",
            "OXM AI 相關功能",
            "OXM 平台提供之其他相關服務",
          ]} />
          <p>本政策不適用於 OXM 平台以外之第三方網站或服務，即使該等網站或服務透過本平台連結前往。</p>
        </Section>

        <Section title="二、個人資料蒐集目的">
          <p>OXM 平台蒐集您的個人資料，目的限於提供及維運平台服務所必要之範圍，包括：</p>
          <Items items={[
            "建立、管理會員帳號",
            "OAuth 登入與身份驗證",
            "工廠建立、刊登、審核與管理",
            "搜尋工廠與企業媒合",
            "詢價、訊息傳遞與聯絡",
            "顧問／企業服務申請",
            "顧問分派與案件管理",
            "通知與客服",
            "OXM AI 功能提供",
            "平台安全與防止濫用",
            "站內使用統計與服務改善",
            "法令遵循與爭議處理",
          ]} />
        </Section>

        <Section title="三、蒐集的資料類型">
          <p>依您使用之功能不同，OXM 平台可能蒐集以下類型之資料（依實際使用情境而定，不代表每位使用者的資料均涵蓋以下全部項目）：</p>

          <SubHeading title="帳號與身份資料">
            <BulletItems items={[
              "姓名",
              "電子郵件",
              "OAuth 帳戶識別資訊（如 Google／LINE／Apple 登入所提供之識別碼與基本資料）",
              "電話（若您有提供）",
            ]} />
          </SubHeading>

          <SubHeading title="公司／工廠資料">
            <BulletItems items={[
              "公司或工廠名稱",
              "統一編號",
              "地址",
              "所屬產業與分類",
              "企業／工廠基本資料與介紹",
              "聯絡資訊",
              "您與工廠之間的管理關係（如負責人、共同管理者）",
            ]} />
          </SubHeading>

          <SubHeading title="詢價與溝通資料">
            <BulletItems items={[
              "詢價內容",
              "站內訊息內容",
              "您主動提供之需求資訊",
              "與媒合、聯繫相關之必要聯絡資訊",
            ]} />
          </SubHeading>

          <SubHeading title="顧問／企業服務資料">
            <p>當您主動申請顧問或企業服務（例如政府補助申請、財務優化、認證輔導、ERP 優化、短影音行銷等服務）時，可能包含：</p>
            <BulletItems items={[
              "公司基本資料",
              "聯絡人與聯絡方式",
              "企業營運或需求相關資訊",
              "申請內容",
              "案件處理狀態",
            ]} />
          </SubHeading>

          <SubHeading title="OXM AI 使用資料">
            <BulletItems items={[
              "您輸入之問題或需求內容",
              "為回答您的問題所需讀取之平台相關資料",
              "AI 功能使用分類與使用量等技術性紀錄",
              "對話摘要／企業記憶（詳見本政策「OXM AI 資料處理」一節）",
            ]} />
          </SubHeading>

          <SubHeading title="技術性資料">
            <p>目前可確認蒐集之技術性資料，僅限於：</p>
            <BulletItems items={[
              "維持登入狀態所必要之 session cookie",
              "用於站內頁面瀏覽統計之識別碼（visitorId）",
            ]} />
          </SubHeading>
        </Section>

        <Section title="四、個人資料利用期間">
          <p>OXM 平台目前並無單一、適用所有資料類型之固定保存年限。依資料類型與用途不同，您的個人資料可能於以下期間內保存：</p>
          <BulletItems items={[
            "會員關係存續期間",
            "提供相關服務所必要期間",
            "完成詢價、案件處理或客服所必要期間",
            "法令要求之保存期間",
            "爭議處理、權利保護或資訊安全所合理必要之期間",
          ]} />
          <p>不同資料類型可能因其對應功能與法令要求，而有不同之保存期間。</p>
        </Section>

        <Section title="五、個人資料利用地區">
          <p>
            您的個人資料可能於中華民國境內，以及 OXM 平台所使用之雲端主機、身份驗證、資料儲存、電子郵件、AI 或推播通知等必要技術服務提供者實際處理資料之地區進行處理。OXM 平台不保證所有資料一律僅存放於單一特定國家或地區。
          </p>
        </Section>

        <Section title="六、個人資料利用對象">
          <p>OXM 平台於提供服務所必要範圍內，可能將您的個人資料提供予以下對象：</p>
          <SubHeading title="1. OXM 平台">
            <p>為提供、維運及改善平台服務而處理。</p>
          </SubHeading>
          <SubHeading title="2. 您主動聯繫之其他會員或工廠">
            <p>例如您主動發送詢價、進行媒合聯繫或站內訊息時，相關必要資訊將提供予被聯繫之一方。</p>
          </SubHeading>
          <SubHeading title="3. OXM 平台所分派或媒合之顧問／企業服務提供者">
            <p>僅限於您主動申請相關顧問或企業服務時，將必要資料提供予受分派或媒合之顧問或服務提供者。</p>
          </SubHeading>
          <SubHeading title="4. 必要之第三方技術服務商">
            <p>例如身份驗證、雲端主機、資料儲存、電子郵件、AI 或推播通知等技術服務提供者，詳見本政策「第三方服務」一節。</p>
          </SubHeading>
          <SubHeading title="5. 依法有權要求之機關">
            <p>依法令規定或司法、主管機關依法定程序要求時。</p>
          </SubHeading>
        </Section>

        <Section title="七、個人資料利用方式">
          <p>OXM 平台可能以自動化或人工方式，於提供服務所必要範圍內：</p>
          <Items items={[
            "驗證您的身份",
            "顯示工廠公開資料",
            "處理搜尋與媒合",
            "傳遞詢價與訊息",
            "處理顧問／企業服務申請",
            "分派顧問或服務提供者",
            "發送必要通知",
            "提供客服協助",
            "產生 OXM AI 回覆",
            "維護平台安全",
            "進行站內統計與功能改善",
          ]} />
        </Section>

        <Section title="八、工廠公開展示資料與一般個人資料之區別">
          <p>
            OXM 平台之工廠頁面具有公開展示性質。當您建立或管理工廠並完成刊登後，部分企業相關資料可能依平台功能公開顯示於工廠頁面，例如：工廠名稱、所屬產業、地區、工廠介紹、商品或服務內容、圖片，以及其他您選擇公開或平台刊登所必要之資料。
          </p>
          <p>
            前項公開展示不包含您的私人 Email、顧問／企業服務申請內容、OXM AI 對話內容或私人站內訊息——這些資料不會公開顯示，僅於提供對應服務所必要範圍內處理。
          </p>
        </Section>

        <Section title="九、詢價與訊息資料">
          <p>
            當您主動向其他會員或工廠發送詢價、傳送站內訊息或提出合作需求時，為完成此項功能，OXM 平台可能將必要之您的身份資訊、公司／工廠資訊、聯絡資訊及詢價／訊息內容，提供或顯示予被您聯繫之一方。
          </p>
          <p>此項資料使用之目的，僅限於完成您主動發起之媒合與溝通，不作其他用途。</p>
        </Section>

        <Section title="十、顧問／企業服務資料">
          <p>
            OXM 平台目前提供多項顧問／企業服務（包括但不限於政府補助申請媒合、財務優化顧問、認證輔導、ERP 優化顧問，以及短影音行銷等服務）。
          </p>
          <p>
            當您主動提出前述服務需求並完成申請後，OXM 平台可能將申請內容中與案件評估、聯絡及服務提供有關之必要資料，提供予 OXM 平台所分派或媒合之顧問或服務提供者，用途限於：需求評估、聯絡、提案、顧問服務提供，以及案件管理。您的資料不會提供予未經分派或媒合、與該次申請無關之其他顧問或服務提供者。
          </p>
        </Section>

        <Section title="十一、OXM AI 資料處理">
          <SubHeading title="對話處理">
            <p>
              當您使用 OXM AI 功能時，您輸入之內容，以及為產生回答所需之 OXM 平台相關資料，可能由 OXM 系統及其採用之 AI 技術服務提供者（目前為 OpenAI）處理，以提供搜尋、整理、推薦、初步分析、平台操作協助等功能。
            </p>
          </SubHeading>
          <SubHeading title="對話保存機制">
            <p>
              您與 OXM AI 進行對話期間，對話內容會暫存於 OXM 系統。一般情況下，對話停止活動一段時間後，系統會嘗試將內容摘要，並將摘要併入該工廠既有的重點資訊記錄中，之後刪除原始逐字對話內容。
            </p>
            <p>
              如摘要或整併過程發生錯誤，原始逐字內容不會立即刪除，而會保留供系統後續重試處理，直到摘要完成為止。
            </p>
          </SubHeading>
          <SubHeading title="企業記憶（Enterprise Memory）">
            <p>
              為了在您日後再次使用 OXM AI 時，能針對同一間工廠提供更連貫的服務，系統可能保留與該工廠相關之摘要式重點資訊，而非逐字對話紀錄。此項摘要式資訊歸屬於該工廠，而非特定個人帳號。OXM AI 不會永久保存您每一次對話的完整逐字內容，但也並非完全不保存任何與 AI 使用相關之資訊。
            </p>
          </SubHeading>
          <SubHeading title="AI 使用紀錄">
            <p>
              OXM 系統可能保存與 AI 功能使用相關之分類、模型呼叫或使用量等技術性紀錄，用於服務管理、使用額度控管、問題排查及功能改善，此類紀錄性質為技術性中繼資料，不等同於另一份完整的聊天紀錄。
            </p>
          </SubHeading>
          <p>
            OXM AI 提供之回覆可能存在錯誤或不完整之情形，僅供您參考使用；詳細說明請參閱 OXM 服務條款。
          </p>
        </Section>

        <Section title="十二、Cookie">
          <p>OXM 平台使用必要性 Cookie，以維持您的登入狀態並進行身份驗證，這是使用會員相關功能所必要之技術。</p>
          <p>目前使用之必要性 Cookie 具備以下安全設定：</p>
          <BulletItems items={[
            "僅供伺服器讀寫，前端網頁程式無法讀取（HttpOnly）",
            "正式環境下僅透過加密連線傳輸（Secure）",
            "限制跨網站請求夾帶（SameSite=Lax）",
            "有效期間最長約 30 天",
          ]} />
          <p>OXM 平台目前未使用行銷或廣告性質之 Cookie。</p>
        </Section>

        <Section title="十三、站內統計與 Analytics">
          <p>
            OXM 平台可能以平台自行建立之識別碼及頁面瀏覽統計，了解服務使用情況並改善平台功能。此項統計為 OXM 平台自建之第一方功能。
          </p>
          <p>OXM 平台目前未使用 Google Analytics、Meta Pixel 或其他跨站廣告追蹤技術。</p>
        </Section>

        <Section title="十四、第三方服務">
          <p>為提供 OXM 平台功能，本平台可能使用下列類型之第三方技術服務，資料僅於提供對應服務所必要範圍內由該服務提供者處理：</p>
          <BulletItems items={[
            "OAuth 身份驗證（例如 Google、LINE、Apple）",
            "雲端主機服務（例如 Render）",
            "雲端物件儲存服務（例如 AWS S3）",
            "電子郵件發送服務（例如 Resend）",
            "AI 技術服務（目前為 OpenAI）",
            "推播通知服務（例如 Firebase）",
          ]} />
          <p>各該第三方服務之資料處理方式，另受該服務提供者自身之隱私權政策規範。</p>
        </Section>

        <Section title="十五、您的個人資料權利">
          <p>依個人資料保護法及相關法令，您就您的個人資料得向 OXM 平台行使下列權利：</p>
          <Items items={[
            "查詢或請求閱覽",
            "請求製給複製本",
            "請求補充或更正",
            "請求停止蒐集",
            "請求停止處理或利用",
            "請求刪除",
          ]} />
          <p>如您欲行使前述權利，可透過本政策末所列 OXM 客服管道提出，OXM 平台將依請求內容、服務必要性、法令要求及技術可行性，於合理期間內處理。</p>
        </Section>

        <Section title="十六、帳號刪除與資料保留">
          <p>
            若您提出刪除帳號、停止利用或其他個人資料權利之請求，OXM 平台將依請求內容、服務必要性、法令要求、權利保護及技術可行性，處理您的相關資料。
          </p>
          <p>部分資料可能因下列原因，於合理必要期間內保留：</p>
          <BulletItems items={[
            "法令要求",
            "爭議處理",
            "資訊安全",
            "防止濫用",
            "權利保護",
          ]} />
        </Section>

        <Section title="十七、未提供資料之影響">
          <p>OXM 平台部分功能所需之個人資料，屬於完成該功能之必要資料。若您未提供：</p>
          <BulletItems items={[
            "登入所需之帳號資料",
            "工廠建立或刊登所需之必要資料",
            "詢價所需之必要資料",
            "顧問／企業服務申請所需之必要資料",
          ]} />
          <p>您可能無法使用相對應之功能。惟本平台不須登入即可使用之公開瀏覽功能，不因此受影響。</p>
        </Section>

        <Section title="十八、資訊安全">
          <p>OXM 平台採取合理之身份驗證、權限控管、系統存取限制及其他必要之技術與管理措施，以保護您的個人資料。</p>
          <p>惟任何資訊系統均無法保證絕對安全，OXM 平台無法保證資料傳輸或儲存過程絕對不會發生未經授權存取、遺失或洩漏之風險，將於發現安全事件時依法令規定處理並通知受影響之使用者。</p>
        </Section>

        <Section title="十九、政策修改">
          <p>OXM 平台得因法令變動、平台功能調整或資料處理方式變更，修改本隱私權政策。</p>
          <p>修改後之最新版本將公布於本平台網站。</p>
        </Section>

        <Section title="二十、聯絡我們">
          <p>如您對本隱私權政策或個人資料處理有任何疑問，可透過 OXM 公開客服管道聯繫：</p>
          <ul className="space-y-1 pl-1">
            <li>電子郵件：<a href="mailto:scottsusu@oxmmatch.com" className="text-orange-600 hover:underline">scottsusu@oxmmatch.com</a></li>
            <li>LINE 官方客服：<a href="https://line.me/ti/p/@785bsmsr" target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:underline">https://line.me/ti/p/@785bsmsr</a></li>
          </ul>
        </Section>

      </div>
    </div>
  );
}
