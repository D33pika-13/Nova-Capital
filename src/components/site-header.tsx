"use client";
import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
export function SiteHeader() {
  const menu = useRef<HTMLDetailsElement>(null);
  const menuButton = useRef<HTMLElement>(null);
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label={`${siteConfig.name} home`}>
          {siteConfig.logoPath ? (
            <Image src={siteConfig.logoPath} width={42} height={42} alt="" />
          ) : (
            <span className="brand-mark">
              {siteConfig.monogram}
              <span>↗</span>
            </span>
          )}
          <span>{siteConfig.name}</span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {siteConfig.navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link href="/login" className="button button-dark header-login">
          Client Login <ArrowUpRight size={16} />
        </Link>
        <details
          ref={menu}
          className="mobile-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.preventDefault();
              closeMenu();
              menuButton.current?.focus();
            }
          }}
        >
          <summary ref={menuButton}>Menu</summary>
          <nav aria-label="Mobile navigation">
            {siteConfig.navigation.map((item) => (
              <Link onClick={closeMenu} href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
            <Link onClick={closeMenu} href="/login">
              Client Login
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
