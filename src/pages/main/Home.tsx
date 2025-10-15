import React from "react";
import "./Home.css";
import { useDidContext } from "../../features/did/DidContext";
import { useI18n } from "../../i18n";
import type { BtcAddress, DidInfo } from "../../features/did/types";

function groupBtcByType(addresses: BtcAddress[]): Array<{ type: BtcAddress["address_type"]; entries: BtcAddress[] }> {
  const map = new Map<BtcAddress["address_type"], BtcAddress[]>();
  addresses.forEach((addr) => {
    const list = map.get(addr.address_type);
    if (list) {
      list.push(addr);
    } else {
      map.set(addr.address_type, [addr]);
    }
  });
  return Array.from(map.entries()).map(([type, entries]) => ({ type, entries }));
}

function displayNickname(did: DidInfo, fallback: string): string {
  const trimmed = did.nickname.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

const Home: React.FC = () => {
  const { dids, activeDid, loading, refresh } = useDidContext();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return (
    <div className="home-wrapper">
      <header className="home-header">
        <div>
          <h1>{t("home.title")}</h1>
          <p>{t("home.subtitle")}</p>
        </div>
        <button
          type="button"
          className="home-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? `${t("home.refresh")}...` : t("home.refresh")}
        </button>
      </header>

      {loading && dids.length === 0 ? (
        <div className="home-placeholder">{t("home.loading")}</div>
      ) : dids.length === 0 ? (
        <div className="home-placeholder">{t("home.empty")}</div>
      ) : (
        <div className="home-list">
          {dids.map((did) => {
            const btcGroups = groupBtcByType(did.btc_addresses);
            const isActive = activeDid?.id === did.id;
            return (
              <article
                key={did.id}
                className={`did-card${isActive ? " did-card-active" : ""}`}
              >
                <div className="did-card-header">
                  <div>
                    <h2>{displayNickname(did, t("common.account.unnamed"))}</h2>
                    <span className="did-id">{did.id}</span>
                  </div>
                  {isActive && <span className="did-badge">{t("home.active_badge")}</span>}
                </div>

                {btcGroups.length > 0 && (
                  <section className="did-section">
                    <h3>{t("home.btc_section")}</h3>
                    <div className="did-addresses">
                      {btcGroups.map((group) => (
                        <div key={group.type} className="did-address-group">
                          <span className="did-address-group-label">
                            {t(`common.btc_type.${group.type}`)}
                          </span>
                          <ul>
                            {group.entries.map((entry) => (
                              <li key={`${group.type}-${entry.index}`}>
                                <span className="did-address-index">
                                  {t("home.address_index", { index: entry.index })}
                                </span>
                                <span className="did-address-value">{entry.address}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {did.eth_addresses.length > 0 && (
                  <section className="did-section">
                    <h3>{t("home.eth_section")}</h3>
                    <ul className="did-addresses">
                      {did.eth_addresses.map((entry) => (
                        <li key={`eth-${entry.index}`} className="did-address-row">
                          <span className="did-address-index">
                            {t("home.address_index", { index: entry.index })}
                          </span>
                          <span className="did-address-value">{entry.address}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {did.bucky_wallets.length > 0 && (
                  <section className="did-section">
                    <h3>{t("home.bucky_section")}</h3>
                    <ul className="did-addresses">
                      {did.bucky_wallets.map((wallet) => (
                        <React.Fragment key={`bucky-${wallet.index}`}>
                          <li className="did-address-row">
                            <span className="did-address-index">
                              {t("home.address_index", { index: wallet.index })}
                            </span>
                            <span className="did-address-value">{wallet.did}</span>
                          </li>
                          {typeof wallet.public_key === "object" &&
                            wallet.public_key !== null &&
                            "x" in wallet.public_key && (
                              <li className="did-address-row">
                                <span className="did-address-index">{t("home.bucky_key_label")}</span>
                                <span className="did-address-value">
                                  {(wallet.public_key as { x?: unknown }).x as string}
                                </span>
                              </li>
                            )}
                        </React.Fragment>
                      ))}
                    </ul>
                  </section>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Home;
