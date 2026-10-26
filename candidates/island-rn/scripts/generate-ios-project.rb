#!/usr/bin/env ruby
require 'fileutils'
require 'xcodeproj'

candidate = File.expand_path('..', __dir__)
repo = File.expand_path('../..', candidate)
ios = File.join(candidate, 'ios')
project_path = File.join(ios, 'MBIslandRn.xcodeproj')
FileUtils.rm_rf(project_path)

project = Xcodeproj::Project.new(project_path)
target = project.new_target(:application, 'MBIslandRn', :ios, '16.4')
target.product_reference.name = 'MBIslandRn.app'

core_package = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
core_package.relative_path = '../../_island-host/ios/Core'
project.root_object.package_references << core_package
core_product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
core_product.package = core_package
core_product.product_name = 'MobileBenchCore'
target.package_product_dependencies << core_product
core_build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
core_build_file.product_ref = core_product
target.frameworks_build_phase.files << core_build_file

def add_sources(project, target, group_name, root, pattern)
  group = project.main_group.new_group(group_name, root)
  Dir.glob(File.join(root, pattern)).sort.each do |path|
    next if File.basename(path) == 'Info.plist'
    target.source_build_phase.add_file_reference(group.new_file(path))
  end
end

shared = File.join(repo, 'candidates/_island-host/ios/App')
add_sources(project, target, 'SharedHost', shared, '**/*.swift')
add_sources(project, target, 'IslandRn', File.join(ios, 'App'), '**/*.swift')

fixtures = File.join(repo, 'candidates/_island-host/generated/assets/fixtures')
resources = project.main_group.new_group('Fixtures')
resources_ref = resources.new_reference(fixtures)
resources_ref.last_known_file_type = 'folder'
target.resources_build_phase.add_file_reference(resources_ref)

target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'org.example.mobilebench.islandrn',
    'PRODUCT_NAME' => 'MBIslandRn',
    'INFOPLIST_FILE' => File.join(shared, 'Info.plist'),
    'SWIFT_VERSION' => '6.0',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.4',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Manual',
    'CODE_SIGN_IDENTITY' => '-',
    'DEVELOPMENT_TEAM' => '',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => '',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'NO',
    'OTHER_LDFLAGS' => '$(inherited) -lc++',
    'ONLY_ACTIVE_ARCH' => 'NO',
    'ARCHS' => 'arm64',
  )
end

bundle = target.new_shell_script_build_phase('Bundle React Native island code')
bundle.shell_script = <<~'SH'
  set -e
  export NODE_BINARY="${NODE_BINARY:-node}"
  export PROJECT_ROOT="$PROJECT_DIR/../rn"
  export REACT_NATIVE_PATH="$PROJECT_ROOT/node_modules/react-native"
  export ENTRY_FILE=index.js
  export BUNDLE_NAME=main
  /bin/sh "$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh" \
    "$REACT_NATIVE_PATH/scripts/react-native-xcode.sh"
SH

project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project_path, 'MBIslandRn', true)
puts "generated #{project_path}"
