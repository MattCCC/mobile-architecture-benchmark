require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "MobileBenchIslandBench"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://example.org/mobile-architecture-benchmark"
  s.license      = package["license"]
  s.authors      = "mobile-architecture-benchmark contributors"
  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => "https://example.org/mobile-architecture-benchmark.git", :tag => "v#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm}"
  s.private_header_files = "ios/**/*.h"
  s.frameworks   = "UIKit"

  install_modules_dependencies(s)
end
